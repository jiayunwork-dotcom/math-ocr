use std::sync::Mutex;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};
use uuid::Uuid;
use image::ImageEncoder;
use base64::{engine::general_purpose, Engine as _};

#[derive(Serialize, Deserialize, Clone)]
pub struct FormulaHistory {
    pub id: String,
    pub latex: String,
    pub thumbnail: String,
    pub is_favorite: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct FormulaTemplate {
    pub id: String,
    pub name: String,
    pub category: String,
    pub latex: String,
    pub thumbnail: String,
    pub created_at: DateTime<Utc>,
    pub use_count: i32,
    pub sort_order: i32,
    pub is_builtin: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct CustomBank {
    pub id: String,
    pub name: String,
    pub difficulty: String,
    pub description: String,
    pub question_count: i32,
    pub share_code: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct BankStatistics {
    pub practice_count: i32,
    pub avg_accuracy: f64,
    pub avg_time: f64,
    pub hardest_question_latex: Option<String>,
    pub hardest_question_error_count: i32,
    pub last_practice_time: Option<String>,
    pub kp_distribution: Vec<KpStatItem>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct KpStatItem {
    pub kp: String,
    pub correct: i32,
    pub wrong: i32,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct BankBriefStat {
    pub bank_id: String,
    pub practice_count: i32,
    pub accuracy: f64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct CustomQuestion {
    pub id: String,
    pub bank_id: String,
    pub latex: String,
    pub knowledge_points: String,
    pub time_limit: i32,
    pub created_at: DateTime<Utc>,
}

struct AppState {
    db: Mutex<Connection>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct PracticeSession {
    pub id: String,
    pub difficulty: String,
    pub total_score: f64,
    pub accuracy: f64,
    pub avg_time: f64,
    pub fastest_time: f64,
    pub slowest_time: f64,
    pub fastest_question: String,
    pub slowest_question: String,
    pub completed_questions: i32,
    pub total_questions: i32,
    pub knowledge_point_scores: String,
    pub difficulty_history: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct PracticeAnswer {
    pub id: String,
    pub session_id: String,
    pub question_latex: String,
    pub recognized_latex: String,
    pub score: f64,
    pub time_spent: f64,
    pub knowledge_points: String,
    pub is_mistake: i32,
    pub created_at: DateTime<Utc>,
}

fn init_db(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS formulas (
            id TEXT PRIMARY KEY,
            latex TEXT NOT NULL,
            thumbnail TEXT NOT NULL,
            is_favorite INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS templates (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            latex TEXT NOT NULL,
            thumbnail TEXT NOT NULL DEFAULT '',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            use_count INTEGER DEFAULT 0,
            sort_order INTEGER DEFAULT 0,
            is_builtin INTEGER DEFAULT 0
        )",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_templates_category ON templates(category)",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS practice_sessions (
            id TEXT PRIMARY KEY,
            difficulty TEXT NOT NULL,
            total_score REAL DEFAULT 0,
            accuracy REAL DEFAULT 0,
            avg_time REAL DEFAULT 0,
            fastest_time REAL DEFAULT 0,
            slowest_time REAL DEFAULT 0,
            fastest_question TEXT DEFAULT '',
            slowest_question TEXT DEFAULT '',
            completed_questions INTEGER DEFAULT 0,
            total_questions INTEGER DEFAULT 15,
            knowledge_point_scores TEXT DEFAULT '{}',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )?;

    // Migration: add difficulty_history column if not exists
    let difficulty_history_col_exists: i64 = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('practice_sessions') WHERE name = 'difficulty_history'")?
        .query_row([], |row| row.get(0))?;
    if difficulty_history_col_exists == 0 {
        conn.execute(
            "ALTER TABLE practice_sessions ADD COLUMN difficulty_history TEXT DEFAULT '[]'",
            [],
        )?;
    }

    conn.execute(
        "CREATE TABLE IF NOT EXISTS practice_answers (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            question_latex TEXT NOT NULL,
            recognized_latex TEXT DEFAULT '',
            score REAL DEFAULT 0,
            time_spent REAL DEFAULT 0,
            knowledge_points TEXT DEFAULT '[]',
            is_mistake INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (session_id) REFERENCES practice_sessions(id)
        )",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_practice_answers_session ON practice_answers(session_id)",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_practice_answers_mistake ON practice_answers(is_mistake)",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS custom_banks (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            difficulty TEXT NOT NULL,
            description TEXT DEFAULT '',
            question_count INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS custom_questions (
            id TEXT PRIMARY KEY,
            bank_id TEXT NOT NULL,
            latex TEXT NOT NULL,
            knowledge_points TEXT DEFAULT '[]',
            time_limit INTEGER NOT NULL DEFAULT 60,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (bank_id) REFERENCES custom_banks(id) ON DELETE CASCADE
        )",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_custom_questions_bank ON custom_questions(bank_id)",
        [],
    )?;

    let source_bank_id_col_exists: i64 = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('practice_answers') WHERE name = 'source_bank_id'")?
        .query_row([], |row| row.get(0))?;
    if source_bank_id_col_exists == 0 {
        conn.execute(
            "ALTER TABLE practice_answers ADD COLUMN source_bank_id TEXT DEFAULT NULL",
            [],
        )?;
    }

    let share_code_col_exists: i64 = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('custom_banks') WHERE name = 'share_code'")?
        .query_row([], |row| row.get(0))?;
    if share_code_col_exists == 0 {
        conn.execute(
            "ALTER TABLE custom_banks ADD COLUMN share_code VARCHAR(8) DEFAULT NULL",
            [],
        )?;
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_banks_share_code ON custom_banks(share_code)",
            [],
        )?;
    }

    init_builtin_templates(conn)?;

    migrate_sort_order_to_zero(conn)?;

    Ok(())
}

fn migrate_sort_order_to_zero(conn: &Connection) -> rusqlite::Result<()> {
    let count: i64 = conn
        .prepare("SELECT COUNT(*) FROM templates WHERE sort_order != 0 AND is_builtin = 1")?
        .query_row([], |row| row.get(0))?;

    if count > 0 {
        conn.execute(
            "UPDATE templates SET sort_order = 0 WHERE is_builtin = 1",
            [],
        )?;
    }

    Ok(())
}

fn init_builtin_templates(conn: &Connection) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare("SELECT COUNT(*) FROM templates WHERE is_builtin = 1")?;
    let count: i64 = stmt.query_row([], |row| row.get(0))?;
    if count > 0 {
        return Ok(());
    }

    let builtin_templates = vec![
        ("分数", "基础运算", "\\frac{a}{b}"),
        ("二次根号", "基础运算", "\\sqrt{x}"),
        ("n次根号", "基础运算", "\\sqrt[n]{x}"),
        ("指数", "基础运算", "x^{n}"),
        ("下标", "基础运算", "x_{i}"),

        ("定积分", "微积分", "\\int_{a}^{b} f(x)\\,dx"),
        ("不定积分", "微积分", "\\int f(x)\\,dx"),
        ("极限", "微积分", "\\lim_{x \\to \\infty} f(x)"),
        ("一阶导数", "微积分", "\\frac{d}{dx}f(x)"),
        ("偏导数", "微积分", "\\frac{\\partial}{\\partial x}f(x,y)"),

        ("2x2矩阵", "线性代数", "\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}"),
        ("3x3矩阵", "线性代数", "\\begin{pmatrix} a & b & c \\\\ d & e & f \\\\ g & h & i \\end{pmatrix}"),
        ("行列式", "线性代数", "\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix}"),
        ("向量", "线性代数", "\\vec{v} = (v_1, v_2, v_3)"),
        ("矩阵乘法", "线性代数", "A_{m \\times n} \\cdot B_{n \\times p}"),

        ("求和", "概率统计", "\\sum_{i=1}^{n} x_i"),
        ("连乘", "概率统计", "\\prod_{i=1}^{n} x_i"),
        ("组合数", "概率统计", "\\binom{n}{k}"),
        ("平均数", "概率统计", "\\bar{x} = \\frac{1}{n}\\sum_{i=1}^{n}x_i"),
        ("标准差", "概率统计", "\\sigma = \\sqrt{\\frac{1}{n}\\sum_{i=1}^{n}(x_i-\\mu)^2}"),

        ("属于", "集合逻辑", "x \\in A"),
        ("子集", "集合逻辑", "A \\subseteq B"),
        ("并集", "集合逻辑", "A \\cup B"),
        ("交集", "集合逻辑", "A \\cap B"),
        ("空集", "集合逻辑", "\\varnothing"),
    ];

    let now = Utc::now();
    for (name, category, latex) in &builtin_templates {
        let id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO templates (id, name, category, latex, created_at, use_count, sort_order, is_builtin) 
             VALUES (?1, ?2, ?3, ?4, ?5, 0, 0, 1)",
            params![id, name, category, latex, now],
        )?;
    }

    Ok(())
}

#[tauri::command]
fn save_formula(latex: String, thumbnail: String, state: tauri::State<AppState>) -> Result<String, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let id = Uuid::new_v4().to_string();
    let now = Utc::now();
    
    conn.execute(
        "INSERT INTO formulas (id, latex, thumbnail, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![id, latex, thumbnail, now],
    ).map_err(|e| e.to_string())?;
    
    Ok(id)
}

#[tauri::command]
fn get_formulas(state: tauri::State<AppState>) -> Result<Vec<FormulaHistory>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    
    let mut stmt = conn.prepare(
        "SELECT id, latex, thumbnail, is_favorite, created_at FROM formulas ORDER BY created_at DESC"
    ).map_err(|e| e.to_string())?;
    
    let formulas = stmt.query_map([], |row| {
        Ok(FormulaHistory {
            id: row.get(0)?,
            latex: row.get(1)?,
            thumbnail: row.get(2)?,
            is_favorite: row.get::<_, i32>(3)? == 1,
            created_at: row.get(4)?,
        })
    }).map_err(|e| e.to_string())?;
    
    let mut result = Vec::new();
    for formula in formulas {
        result.push(formula.map_err(|e| e.to_string())?);
    }
    
    Ok(result)
}

#[tauri::command]
fn search_formulas(query: String, state: tauri::State<AppState>) -> Result<Vec<FormulaHistory>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let search_pattern = format!("%{}%", query);
    
    let mut stmt = conn.prepare(
        "SELECT id, latex, thumbnail, is_favorite, created_at FROM formulas 
         WHERE latex LIKE ?1 ORDER BY created_at DESC"
    ).map_err(|e| e.to_string())?;
    
    let formulas = stmt.query_map(params![search_pattern], |row| {
        Ok(FormulaHistory {
            id: row.get(0)?,
            latex: row.get(1)?,
            thumbnail: row.get(2)?,
            is_favorite: row.get::<_, i32>(3)? == 1,
            created_at: row.get(4)?,
        })
    }).map_err(|e| e.to_string())?;
    
    let mut result = Vec::new();
    for formula in formulas {
        result.push(formula.map_err(|e| e.to_string())?);
    }
    
    Ok(result)
}

#[tauri::command]
fn toggle_favorite(id: String, state: tauri::State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    
    conn.execute(
        "UPDATE formulas SET is_favorite = 1 - is_favorite WHERE id = ?1",
        params![id],
    ).map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
fn delete_formula(id: String, state: tauri::State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    
    conn.execute(
        "DELETE FROM formulas WHERE id = ?1",
        params![id],
    ).map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
fn save_template(
    name: String,
    category: String,
    latex: String,
    thumbnail: String,
    state: tauri::State<AppState>,
) -> Result<String, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let id = Uuid::new_v4().to_string();
    let now = Utc::now();

    let max_sort: i32 = conn
        .prepare("SELECT COALESCE(MAX(sort_order), -1) FROM templates WHERE category = ?1")
        .map_err(|e| e.to_string())?
        .query_row(params![category], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO templates (id, name, category, latex, thumbnail, created_at, use_count, sort_order, is_builtin) 
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, 0)",
        params![id, name, category, latex, thumbnail, now, max_sort + 1],
    ).map_err(|e| e.to_string())?;

    Ok(id)
}

#[tauri::command]
fn get_templates(state: tauri::State<AppState>) -> Result<Vec<FormulaTemplate>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare(
        "SELECT id, name, category, latex, thumbnail, created_at, use_count, sort_order, is_builtin 
         FROM templates 
         ORDER BY category ASC, sort_order ASC, use_count DESC, created_at DESC"
    ).map_err(|e| e.to_string())?;

    let templates = stmt.query_map([], |row| {
        Ok(FormulaTemplate {
            id: row.get(0)?,
            name: row.get(1)?,
            category: row.get(2)?,
            latex: row.get(3)?,
            thumbnail: row.get(4)?,
            created_at: row.get(5)?,
            use_count: row.get(6)?,
            sort_order: row.get(7)?,
            is_builtin: row.get::<_, i32>(8)? == 1,
        })
    }).map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for template in templates {
        result.push(template.map_err(|e| e.to_string())?);
    }

    Ok(result)
}

#[tauri::command]
fn search_templates(query: String, state: tauri::State<AppState>) -> Result<Vec<FormulaTemplate>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let search_pattern = format!("%{}%", query);

    let mut stmt = conn.prepare(
        "SELECT id, name, category, latex, thumbnail, created_at, use_count, sort_order, is_builtin 
         FROM templates 
         WHERE name LIKE ?1 OR latex LIKE ?1
         ORDER BY use_count DESC, sort_order ASC, created_at DESC"
    ).map_err(|e| e.to_string())?;

    let templates = stmt.query_map(params![search_pattern], |row| {
        Ok(FormulaTemplate {
            id: row.get(0)?,
            name: row.get(1)?,
            category: row.get(2)?,
            latex: row.get(3)?,
            thumbnail: row.get(4)?,
            created_at: row.get(5)?,
            use_count: row.get(6)?,
            sort_order: row.get(7)?,
            is_builtin: row.get::<_, i32>(8)? == 1,
        })
    }).map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for template in templates {
        result.push(template.map_err(|e| e.to_string())?);
    }

    Ok(result)
}

#[tauri::command]
fn increment_template_use(id: String, state: tauri::State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE templates SET use_count = use_count + 1 WHERE id = ?1",
        params![id],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn update_template_order(
    category: String,
    ordered_ids: Vec<String>,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    for (idx, template_id) in ordered_ids.iter().enumerate() {
        conn.execute(
            "UPDATE templates SET sort_order = ?1 WHERE id = ?2 AND category = ?3",
            params![idx as i32, template_id, category],
        ).map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
fn delete_template(id: String, state: tauri::State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    conn.execute(
        "DELETE FROM templates WHERE id = ?1 AND is_builtin = 0",
        params![id],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn get_template_categories(state: tauri::State<AppState>) -> Result<Vec<String>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare(
        "SELECT DISTINCT category FROM templates ORDER BY category ASC"
    ).map_err(|e| e.to_string())?;

    let categories = stmt.query_map([], |row| row.get(0)).map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for cat in categories {
        result.push(cat.map_err(|e| e.to_string())?);
    }

    Ok(result)
}

#[tauri::command]
fn pin_template_to_top(id: String, state: tauri::State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let category: String = conn
        .prepare("SELECT category FROM templates WHERE id = ?1")
        .map_err(|e| e.to_string())?
        .query_row(params![id], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    let current_sort: i32 = conn
        .prepare("SELECT sort_order FROM templates WHERE id = ?1")
        .map_err(|e| e.to_string())?
        .query_row(params![id], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE templates SET sort_order = sort_order + 1 
         WHERE category = ?1 AND sort_order < ?2",
        params![category, current_sort],
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE templates SET sort_order = 0 WHERE id = ?1",
        params![id],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn export_png(
    canvas_data: String,
    width: u32,
    height: u32,
    background: String,
    output_path: String,
) -> Result<(), String> {
    let data = if let Some(stripped) = canvas_data.strip_prefix("data:image/png;base64,") {
        stripped
    } else {
        &canvas_data
    };
    
    let bytes = general_purpose::STANDARD.decode(data).map_err(|e| e.to_string())?;
    
    let img = image::load_from_memory(&bytes).map_err(|e| e.to_string())?;
    
    let bg_rgb = hex_to_rgb(&background).unwrap_or((255, 255, 255));
    
    let mut rgba_img = img.to_rgba8();
    
    for pixel in rgba_img.pixels_mut() {
        if pixel.0[3] == 0 {
            pixel.0 = [bg_rgb.0, bg_rgb.1, bg_rgb.2, 255];
        }
    }
    
    let resized = image::imageops::resize(
        &rgba_img,
        width,
        height,
        image::imageops::FilterType::Lanczos3,
    );
    
    resized.save(output_path).map_err(|e| e.to_string())?;
    
    Ok(())
}

fn hex_to_rgb(hex: &str) -> Option<(u8, u8, u8)> {
    let hex = hex.trim_start_matches('#');
    if hex.len() != 6 {
        return None;
    }
    
    let r = u8::from_str_radix(&hex[0..2], 16).ok()?;
    let g = u8::from_str_radix(&hex[2..4], 16).ok()?;
    let b = u8::from_str_radix(&hex[4..6], 16).ok()?;
    
    Some((r, g, b))
}

#[tauri::command]
fn batch_recognize(image_data: String) -> Result<Vec<(String, String)>, String> {
    let data = if let Some(stripped) = image_data.strip_prefix("data:image/png;base64,") {
        stripped
    } else if let Some(stripped) = image_data.strip_prefix("data:image/jpeg;base64,") {
        stripped
    } else {
        &image_data
    };
    
    let bytes = general_purpose::STANDARD.decode(data).map_err(|e| e.to_string())?;
    let img = image::load_from_memory(&bytes).map_err(|e| e.to_string())?;
    let gray = img.to_luma8();
    
    let (width, height) = gray.dimensions();
    let mut regions = Vec::new();
    
    let mut visited = vec![vec![false; width as usize]; height as usize];
    let threshold = 128;
    
    for y in 0..height {
        for x in 0..width {
            if !visited[y as usize][x as usize] && gray.get_pixel(x, y).0[0] < threshold {
                let mut min_x = x;
                let mut max_x = x;
                let mut min_y = y;
                let mut max_y = y;
                let mut stack = vec![(x, y)];
                
                while let Some((cx, cy)) = stack.pop() {
                    if cx >= width || cy >= height {
                        continue;
                    }
                    if visited[cy as usize][cx as usize] {
                        continue;
                    }
                    if gray.get_pixel(cx, cy).0[0] >= threshold {
                        continue;
                    }
                    
                    visited[cy as usize][cx as usize] = true;
                    min_x = min_x.min(cx);
                    max_x = max_x.max(cx);
                    min_y = min_y.min(cy);
                    max_y = max_y.max(cy);
                    
                    if cx > 0 { stack.push((cx - 1, cy)); }
                    if cx + 1 < width { stack.push((cx + 1, cy)); }
                    if cy > 0 { stack.push((cx, cy - 1)); }
                    if cy + 1 < height { stack.push((cx, cy + 1)); }
                }
                
                let w = max_x - min_x;
                let h = max_y - min_y;
                if w > 5 && h > 5 {
                    let padding = 5;
                    min_x = if min_x > padding { min_x - padding } else { 0 };
                    min_y = if min_y > padding { min_y - padding } else { 0 };
                    max_x = if max_x + padding < width { max_x + padding } else { width - 1 };
                    max_y = if max_y + padding < height { max_y + padding } else { height - 1 };
                    
                    regions.push((min_x, min_y, max_x, max_y));
                }
            }
        }
    }
    
    regions.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));
    
    let mut results = Vec::new();
    for (i, (min_x, min_y, max_x, max_y)) in regions.iter().enumerate() {
        let region_img = image::imageops::crop_imm(
            &gray,
            *min_x,
            *min_y,
            max_x - min_x + 1,
            max_y - min_y + 1,
        ).to_image();
        
        let mut buf = Vec::new();
        let mut cursor = std::io::Cursor::new(&mut buf);
        image::codecs::png::PngEncoder::new(&mut cursor)
            .write_image(
                &region_img,
                region_img.width(),
                region_img.height(),
                image::ColorType::L8.into(),
            )
            .map_err(|e| e.to_string())?;
        
        let region_base64 = general_purpose::STANDARD.encode(&buf);
        results.push((format!("region_{}", i), region_base64));
    }
    
    Ok(results)
}

fn get_app_data_dir() -> std::path::PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    let path = std::path::PathBuf::from(home).join(".math-ocr");
    std::fs::create_dir_all(&path).ok();
    path
}

#[tauri::command]
fn save_practice_session(
    difficulty: String,
    total_score: f64,
    accuracy: f64,
    avg_time: f64,
    fastest_time: f64,
    slowest_time: f64,
    fastest_question: String,
    slowest_question: String,
    completed_questions: i32,
    total_questions: i32,
    knowledge_point_scores: String,
    difficulty_history: String,
    state: tauri::State<AppState>,
) -> Result<String, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let id = Uuid::new_v4().to_string();
    let now = Utc::now();

    conn.execute(
        "INSERT INTO practice_sessions (id, difficulty, total_score, accuracy, avg_time, fastest_time, slowest_time, fastest_question, slowest_question, completed_questions, total_questions, knowledge_point_scores, difficulty_history, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![id, difficulty, total_score, accuracy, avg_time, fastest_time, slowest_time, fastest_question, slowest_question, completed_questions, total_questions, knowledge_point_scores, difficulty_history, now],
    ).map_err(|e| e.to_string())?;

    Ok(id)
}

#[tauri::command]
fn save_png_file(
    base64_data: String,
    output_path: String,
) -> Result<(), String> {
    let data = if let Some(stripped) = base64_data.strip_prefix("data:image/png;base64,") {
        stripped
    } else {
        &base64_data
    };
    
    let bytes = general_purpose::STANDARD.decode(data).map_err(|e| e.to_string())?;
    std::fs::write(&output_path, &bytes).map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
fn create_custom_bank(
    name: String,
    difficulty: String,
    description: String,
    state: tauri::State<AppState>,
) -> Result<CustomBank, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let dup: i64 = conn
        .prepare("SELECT COUNT(*) FROM custom_banks WHERE name = ?1")
        .map_err(|e| e.to_string())?
        .query_row(params![name], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if dup > 0 {
        return Err("题库名称已存在".to_string());
    }

    let id = Uuid::new_v4().to_string();
    let now = Utc::now();

    conn.execute(
        "INSERT INTO custom_banks (id, name, difficulty, description, question_count, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6)",
        params![id, name, difficulty, description, now, now],
    ).map_err(|e| e.to_string())?;

    Ok(CustomBank {
        id,
        name,
        difficulty,
        description,
        question_count: 0,
        share_code: None,
        created_at: now,
        updated_at: now,
    })
}

#[tauri::command]
fn get_custom_banks(state: tauri::State<AppState>) -> Result<Vec<CustomBank>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare(
        "SELECT id, name, difficulty, description, question_count, share_code, created_at, updated_at FROM custom_banks ORDER BY created_at DESC"
    ).map_err(|e| e.to_string())?;

    let banks = stmt.query_map([], |row| {
        Ok(CustomBank {
            id: row.get(0)?,
            name: row.get(1)?,
            difficulty: row.get(2)?,
            description: row.get(3)?,
            question_count: row.get(4)?,
            share_code: row.get(5)?,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for bank in banks {
        result.push(bank.map_err(|e| e.to_string())?);
    }

    Ok(result)
}

#[tauri::command]
fn update_custom_bank(
    id: String,
    name: String,
    difficulty: String,
    description: String,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let dup: i64 = conn
        .prepare("SELECT COUNT(*) FROM custom_banks WHERE name = ?1 AND id != ?2")
        .map_err(|e| e.to_string())?
        .query_row(params![name, id], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if dup > 0 {
        return Err("题库名称已存在".to_string());
    }

    let now = Utc::now();
    conn.execute(
        "UPDATE custom_banks SET name = ?1, difficulty = ?2, description = ?3, updated_at = ?4 WHERE id = ?5",
        params![name, difficulty, description, now, id],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn delete_custom_bank(id: String, state: tauri::State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let ref_count: i64 = conn
        .prepare("SELECT COUNT(*) FROM practice_answers WHERE source_bank_id = ?1")
        .map_err(|e| e.to_string())?
        .query_row(params![id], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if ref_count > 0 {
        return Err("该题库有关联的练习记录，无法删除".to_string());
    }

    conn.execute(
        "DELETE FROM custom_questions WHERE bank_id = ?1",
        params![id],
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "DELETE FROM custom_banks WHERE id = ?1",
        params![id],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn add_custom_question(
    bank_id: String,
    latex: String,
    knowledge_points: String,
    time_limit: i32,
    state: tauri::State<AppState>,
) -> Result<CustomQuestion, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let id = Uuid::new_v4().to_string();
    let now = Utc::now();

    conn.execute(
        "INSERT INTO custom_questions (id, bank_id, latex, knowledge_points, time_limit, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, bank_id, latex, knowledge_points, time_limit, now],
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE custom_banks SET question_count = question_count + 1, updated_at = ?1 WHERE id = ?2",
        params![now, bank_id],
    ).map_err(|e| e.to_string())?;

    Ok(CustomQuestion {
        id,
        bank_id,
        latex,
        knowledge_points,
        time_limit,
        created_at: now,
    })
}

#[tauri::command]
fn get_custom_questions(bank_id: String, state: tauri::State<AppState>) -> Result<Vec<CustomQuestion>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare(
        "SELECT id, bank_id, latex, knowledge_points, time_limit, created_at FROM custom_questions WHERE bank_id = ?1 ORDER BY created_at ASC"
    ).map_err(|e| e.to_string())?;

    let questions = stmt.query_map(params![bank_id], |row| {
        Ok(CustomQuestion {
            id: row.get(0)?,
            bank_id: row.get(1)?,
            latex: row.get(2)?,
            knowledge_points: row.get(3)?,
            time_limit: row.get(4)?,
            created_at: row.get(5)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for q in questions {
        result.push(q.map_err(|e| e.to_string())?);
    }

    Ok(result)
}

#[tauri::command]
fn update_custom_question(
    id: String,
    latex: String,
    knowledge_points: String,
    time_limit: i32,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let bank_id: String = conn
        .prepare("SELECT bank_id FROM custom_questions WHERE id = ?1")
        .map_err(|e| e.to_string())?
        .query_row(params![id], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    let now = Utc::now();
    conn.execute(
        "UPDATE custom_questions SET latex = ?1, knowledge_points = ?2, time_limit = ?3 WHERE id = ?4",
        params![latex, knowledge_points, time_limit, id],
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE custom_banks SET updated_at = ?1 WHERE id = ?2",
        params![now, bank_id],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn delete_custom_question(id: String, state: tauri::State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let bank_id: String = conn
        .prepare("SELECT bank_id FROM custom_questions WHERE id = ?1")
        .map_err(|e| e.to_string())?
        .query_row(params![id], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    let now = Utc::now();
    conn.execute(
        "DELETE FROM custom_questions WHERE id = ?1",
        params![id],
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE custom_banks SET question_count = question_count - 1, updated_at = ?1 WHERE id = ?2",
        params![now, bank_id],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn batch_add_custom_questions(
    bank_id: String,
    questions_json: String,
    state: tauri::State<AppState>,
) -> Result<i32, String> {
    let questions: Vec<serde_json::Value> = serde_json::from_str(&questions_json)
        .map_err(|e| format!("JSON格式错误: {}", e))?;

    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let now = Utc::now();
    let mut added = 0;

    for (idx, q) in questions.iter().enumerate() {
        let latex = q.get("latex")
            .and_then(|v| v.as_str())
            .ok_or_else(|| format!("第{}条题目缺少latex字段", idx + 1))?;

        let knowledge_points = q.get("knowledge_points")
            .and_then(|v| v.as_str())
            .ok_or_else(|| format!("第{}条题目缺少knowledge_points字段", idx + 1))?;

        let kp_list: Vec<String> = serde_json::from_str(knowledge_points)
            .map_err(|_| format!("第{}条题目的knowledge_points格式错误", idx + 1))?;

        let valid_kps = ["指数", "分数", "根号", "积分", "矩阵", "括号"];
        for kp in &kp_list {
            if !valid_kps.contains(&kp.as_str()) {
                return Err(format!("第{}条题目的知识点\"{}\"不在合法范围内", idx + 1, kp));
            }
        }

        let time_limit = q.get("time_limit")
            .and_then(|v| v.as_i64())
            .ok_or_else(|| format!("第{}条题目缺少time_limit字段", idx + 1))?;

        if time_limit < 30 || time_limit > 300 {
            return Err(format!("第{}条题目的限时必须在30-300之间", idx + 1));
        }

        let id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO custom_questions (id, bank_id, latex, knowledge_points, time_limit, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, bank_id, latex, knowledge_points, time_limit as i32, now],
        ).map_err(|e| e.to_string())?;

        added += 1;
    }

    conn.execute(
        "UPDATE custom_banks SET question_count = question_count + ?1, updated_at = ?2 WHERE id = ?3",
        params![added, now, bank_id],
    ).map_err(|e| e.to_string())?;

    Ok(added)
}

#[tauri::command]
fn save_practice_answer(
    session_id: String,
    question_latex: String,
    recognized_latex: String,
    score: f64,
    time_spent: f64,
    knowledge_points: String,
    is_mistake: i32,
    source_bank_id: Option<String>,
    state: tauri::State<AppState>,
) -> Result<String, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let id = Uuid::new_v4().to_string();
    let now = Utc::now();

    conn.execute(
        "INSERT INTO practice_answers (id, session_id, question_latex, recognized_latex, score, time_spent, knowledge_points, is_mistake, source_bank_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![id, session_id, question_latex, recognized_latex, score, time_spent, knowledge_points, is_mistake, source_bank_id, now],
    ).map_err(|e| e.to_string())?;

    Ok(id)
}

#[tauri::command]
fn get_practice_sessions(
    difficulty_filter: Option<String>,
    sort_order: Option<String>,
    state: tauri::State<AppState>,
) -> Result<Vec<PracticeSession>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let order = match sort_order.as_deref() {
        Some("asc") => "ASC",
        _ => "DESC",
    };

    let sql = if difficulty_filter.is_some() {
        format!("SELECT id, difficulty, total_score, accuracy, avg_time, fastest_time, slowest_time, fastest_question, slowest_question, completed_questions, total_questions, knowledge_point_scores, difficulty_history, created_at FROM practice_sessions WHERE difficulty = ?1 ORDER BY created_at {}", order)
    } else {
        format!("SELECT id, difficulty, total_score, accuracy, avg_time, fastest_time, slowest_time, fastest_question, slowest_question, completed_questions, total_questions, knowledge_point_scores, difficulty_history, created_at FROM practice_sessions ORDER BY created_at {}", order)
    };

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let map_row = |row: &rusqlite::Row| -> rusqlite::Result<PracticeSession> {
        Ok(PracticeSession {
            id: row.get(0)?,
            difficulty: row.get(1)?,
            total_score: row.get(2)?,
            accuracy: row.get(3)?,
            avg_time: row.get(4)?,
            fastest_time: row.get(5)?,
            slowest_time: row.get(6)?,
            fastest_question: row.get(7)?,
            slowest_question: row.get(8)?,
            completed_questions: row.get(9)?,
            total_questions: row.get(10)?,
            knowledge_point_scores: row.get(11)?,
            difficulty_history: row.get(12)?,
            created_at: row.get(13)?,
        })
    };

    let sessions = if let Some(ref diff) = difficulty_filter {
        stmt.query_map(params![diff], map_row).map_err(|e| e.to_string())?
    } else {
        stmt.query_map([], map_row).map_err(|e| e.to_string())?
    };

    let mut result = Vec::new();
    for session in sessions {
        result.push(session.map_err(|e| e.to_string())?);
    }

    Ok(result)
}

#[tauri::command]
fn get_practice_answers(
    session_id: String,
    state: tauri::State<AppState>,
) -> Result<Vec<PracticeAnswer>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare(
        "SELECT id, session_id, question_latex, recognized_latex, score, time_spent, knowledge_points, is_mistake, created_at FROM practice_answers WHERE session_id = ?1 ORDER BY created_at ASC"
    ).map_err(|e| e.to_string())?;

    let answers = stmt.query_map(params![session_id], |row| {
        Ok(PracticeAnswer {
            id: row.get(0)?,
            session_id: row.get(1)?,
            question_latex: row.get(2)?,
            recognized_latex: row.get(3)?,
            score: row.get(4)?,
            time_spent: row.get(5)?,
            knowledge_points: row.get(6)?,
            is_mistake: row.get(7)?,
            created_at: row.get(8)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for answer in answers {
        result.push(answer.map_err(|e| e.to_string())?);
    }

    Ok(result)
}

#[tauri::command]
fn get_mistakes(state: tauri::State<AppState>) -> Result<Vec<PracticeAnswer>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare(
        "SELECT id, session_id, question_latex, recognized_latex, score, time_spent, knowledge_points, is_mistake, created_at FROM practice_answers WHERE is_mistake = 1 ORDER BY created_at DESC"
    ).map_err(|e| e.to_string())?;

    let answers = stmt.query_map([], |row| {
        Ok(PracticeAnswer {
            id: row.get(0)?,
            session_id: row.get(1)?,
            question_latex: row.get(2)?,
            recognized_latex: row.get(3)?,
            score: row.get(4)?,
            time_spent: row.get(5)?,
            knowledge_points: row.get(6)?,
            is_mistake: row.get(7)?,
            created_at: row.get(8)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for answer in answers {
        result.push(answer.map_err(|e| e.to_string())?);
    }

    Ok(result)
}

#[tauri::command]
fn remove_mistake(id: String, state: tauri::State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE practice_answers SET is_mistake = 0 WHERE id = ?1",
        params![id],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn delete_practice_session(id: String, state: tauri::State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    conn.execute(
        "DELETE FROM practice_answers WHERE session_id = ?1",
        params![id],
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "DELETE FROM practice_sessions WHERE id = ?1",
        params![id],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn get_bank_statistics(bank_id: String, state: tauri::State<AppState>) -> Result<BankStatistics, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let total_count: i64 = conn
        .prepare("SELECT COUNT(*) FROM practice_answers WHERE source_bank_id = ?1")
        .map_err(|e| e.to_string())?
        .query_row(params![bank_id], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    if total_count == 0 {
        return Ok(BankStatistics {
            practice_count: 0,
            avg_accuracy: 0.0,
            avg_time: 0.0,
            hardest_question_latex: None,
            hardest_question_error_count: 0,
            last_practice_time: None,
            kp_distribution: vec![],
        });
    }

    let session_count: i64 = conn
        .prepare("SELECT COUNT(DISTINCT session_id) FROM practice_answers WHERE source_bank_id = ?1")
        .map_err(|e| e.to_string())?
        .query_row(params![bank_id], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    let avg_time: f64 = conn
        .prepare("SELECT AVG(time_spent) FROM practice_answers WHERE source_bank_id = ?1")
        .map_err(|e| e.to_string())?
        .query_row(params![bank_id], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    let correct_count: i64 = conn
        .prepare("SELECT COUNT(*) FROM practice_answers WHERE source_bank_id = ?1 AND score >= 60")
        .map_err(|e| e.to_string())?
        .query_row(params![bank_id], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    let accuracy = if total_count > 0 {
        correct_count as f64 / total_count as f64
    } else {
        0.0
    };

    let hardest_result = conn
        .prepare(
            "SELECT question_latex, COUNT(*) as error_count 
             FROM practice_answers 
             WHERE source_bank_id = ?1 AND score < 60 
             GROUP BY question_latex 
             ORDER BY error_count DESC 
             LIMIT 1"
        )
        .map_err(|e| e.to_string())?
        .query_row(params![bank_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .ok();

    let (hardest_latex, hardest_count) = match hardest_result {
        Some((latex, count)) => (Some(latex), count as i32),
        None => (None, 0),
    };

    let last_time: Option<String> = conn
        .prepare("SELECT MAX(created_at) FROM practice_answers WHERE source_bank_id = ?1")
        .map_err(|e| e.to_string())?
        .query_row(params![bank_id], |row| row.get::<_, Option<String>>(0))
        .map_err(|e| e.to_string())?;

    let valid_kps = ["指数", "分数", "根号", "积分", "矩阵", "括号"];
    let mut kp_stats: std::collections::HashMap<String, (i32, i32)> = std::collections::HashMap::new();
    for kp in &valid_kps {
        kp_stats.insert(kp.to_string(), (0, 0));
    }

    let mut stmt = conn.prepare(
        "SELECT knowledge_points, score FROM practice_answers WHERE source_bank_id = ?1"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map(params![bank_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?))
    }).map_err(|e| e.to_string())?;

    for row in rows {
        let (kp_str, score) = row.map_err(|e| e.to_string())?;
        let kp_list: Vec<String> = serde_json::from_str(&kp_str).unwrap_or_default();
        for kp in kp_list {
            if valid_kps.contains(&kp.as_str()) {
                if let Some(entry) = kp_stats.get_mut(&kp) {
                    if score >= 60.0 {
                        entry.0 += 1;
                    } else {
                        entry.1 += 1;
                    }
                }
            }
        }
    }

    let mut kp_distribution: Vec<KpStatItem> = kp_stats
        .into_iter()
        .filter(|(_, (correct, wrong))| *correct > 0 || *wrong > 0)
        .map(|(kp, (correct, wrong))| KpStatItem { kp, correct, wrong })
        .collect();

    kp_distribution.sort_by(|a, b| a.kp.cmp(&b.kp));

    let avg_time_rounded = (avg_time * 10.0).round() / 10.0;

    Ok(BankStatistics {
        practice_count: session_count as i32,
        avg_accuracy: accuracy,
        avg_time: avg_time_rounded,
        hardest_question_latex: hardest_latex,
        hardest_question_error_count: hardest_count,
        last_practice_time: last_time,
        kp_distribution,
    })
}

#[tauri::command]
fn get_banks_brief_stats(bank_ids: Vec<String>, state: tauri::State<AppState>) -> Result<Vec<BankBriefStat>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut result = Vec::new();

    for bank_id in &bank_ids {
        let total_count: i64 = conn
            .prepare("SELECT COUNT(*) FROM practice_answers WHERE source_bank_id = ?1")
            .map_err(|e| e.to_string())?
            .query_row(params![bank_id], |row| row.get(0))
            .map_err(|e| e.to_string())?;

        if total_count == 0 {
            result.push(BankBriefStat {
                bank_id: bank_id.clone(),
                practice_count: 0,
                accuracy: 0.0,
            });
            continue;
        }

        let session_count: i64 = conn
            .prepare("SELECT COUNT(DISTINCT session_id) FROM practice_answers WHERE source_bank_id = ?1")
            .map_err(|e| e.to_string())?
            .query_row(params![bank_id], |row| row.get(0))
            .map_err(|e| e.to_string())?;

        let correct_count: i64 = conn
            .prepare("SELECT COUNT(*) FROM practice_answers WHERE source_bank_id = ?1 AND score >= 60")
            .map_err(|e| e.to_string())?
            .query_row(params![bank_id], |row| row.get(0))
            .map_err(|e| e.to_string())?;

        let accuracy = if total_count > 0 {
            correct_count as f64 / total_count as f64
        } else {
            0.0
        };

        result.push(BankBriefStat {
            bank_id: bank_id.clone(),
            practice_count: session_count as i32,
            accuracy,
        });
    }

    Ok(result)
}

fn generate_random_code() -> String {
    use rand::Rng;
    const CHARSET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const LENGTH: usize = 8;
    let mut rng = rand::thread_rng();
    (0..LENGTH)
        .map(|_| {
            let idx = rng.gen_range(0..CHARSET.len());
            CHARSET[idx] as char
        })
        .collect()
}

#[tauri::command]
fn generate_share_code(bank_id: String, state: tauri::State<AppState>) -> Result<String, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let existing: Option<String> = conn
        .prepare("SELECT share_code FROM custom_banks WHERE id = ?1")
        .map_err(|e| e.to_string())?
        .query_row(params![bank_id], |row| row.get(0))
        .ok()
        .flatten();

    if let Some(code) = existing {
        return Ok(code);
    }

    let mut share_code = generate_random_code();
    loop {
        let exists: i64 = conn
            .prepare("SELECT COUNT(*) FROM custom_banks WHERE share_code = ?1")
            .map_err(|e| e.to_string())?
            .query_row(params![share_code], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        if exists == 0 {
            break;
        }
        share_code = generate_random_code();
    }

    conn.execute(
        "UPDATE custom_banks SET share_code = ?1 WHERE id = ?2",
        params![share_code, bank_id],
    ).map_err(|e| e.to_string())?;

    Ok(share_code)
}

#[tauri::command]
fn import_bank_by_share_code(share_code: String, state: tauri::State<AppState>) -> Result<CustomBank, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let source_bank_result = conn
        .prepare("SELECT id, name, difficulty, description, question_count, share_code, created_at, updated_at FROM custom_banks WHERE share_code = ?1")
        .map_err(|e| e.to_string())?
        .query_row(params![share_code], |row| {
            Ok(CustomBank {
                id: row.get(0)?,
                name: row.get(1)?,
                difficulty: row.get(2)?,
                description: row.get(3)?,
                question_count: row.get(4)?,
                share_code: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })
        .map_err(|_| "分享码无效".to_string())?;

    let new_name = format!("{}(导入)", source_bank_result.name);
    let new_id = Uuid::new_v4().to_string();
    let now = Utc::now();

    conn.execute(
        "INSERT INTO custom_banks (id, name, difficulty, description, question_count, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6)",
        params![new_id, new_name, source_bank_result.difficulty, source_bank_result.description, now, now],
    ).map_err(|e| e.to_string())?;

    let questions: Vec<CustomQuestion> = {
        let mut stmt = conn.prepare(
            "SELECT id, bank_id, latex, knowledge_points, time_limit, created_at FROM custom_questions WHERE bank_id = ?1 ORDER BY created_at ASC"
        ).map_err(|e| e.to_string())?;

        let qs = stmt.query_map(params![source_bank_result.id], |row| {
            Ok(CustomQuestion {
                id: row.get(0)?,
                bank_id: row.get(1)?,
                latex: row.get(2)?,
                knowledge_points: row.get(3)?,
                time_limit: row.get(4)?,
                created_at: row.get(5)?,
            })
        }).map_err(|e| e.to_string())?;

        let mut result = Vec::new();
        for q in qs {
            result.push(q.map_err(|e| e.to_string())?);
        }
        result
    };

    let count = questions.len() as i32;
    for q in &questions {
        let q_id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO custom_questions (id, bank_id, latex, knowledge_points, time_limit, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![q_id, new_id, q.latex, q.knowledge_points, q.time_limit, now],
        ).map_err(|e| e.to_string())?;
    }

    conn.execute(
        "UPDATE custom_banks SET question_count = ?1, updated_at = ?2 WHERE id = ?3",
        params![count, now, new_id],
    ).map_err(|e| e.to_string())?;

    Ok(CustomBank {
        id: new_id,
        name: new_name,
        difficulty: source_bank_result.difficulty,
        description: source_bank_result.description,
        question_count: count,
        share_code: None,
        created_at: now,
        updated_at: now,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_data_dir = get_app_data_dir();
    let db_path = app_data_dir.join("formulas.db");
    let conn = Connection::open(&db_path).expect("failed to open database");
    
    init_db(&conn).expect("failed to initialize database");
    
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState {
            db: Mutex::new(conn),
        })
        .invoke_handler(tauri::generate_handler![
            save_formula,
            get_formulas,
            search_formulas,
            toggle_favorite,
            delete_formula,
            save_template,
            get_templates,
            search_templates,
            increment_template_use,
            update_template_order,
            delete_template,
            get_template_categories,
            pin_template_to_top,
            export_png,
            batch_recognize,
            save_practice_session,
            save_practice_answer,
            get_practice_sessions,
            get_practice_answers,
            get_mistakes,
            remove_mistake,
            delete_practice_session,
            save_png_file,
            create_custom_bank,
            get_custom_banks,
            update_custom_bank,
            delete_custom_bank,
            add_custom_question,
            get_custom_questions,
            update_custom_question,
            delete_custom_question,
            batch_add_custom_questions,
            get_bank_statistics,
            get_banks_brief_stats,
            generate_share_code,
            import_bank_by_share_code,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
