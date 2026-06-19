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

struct AppState {
    db: Mutex<Connection>,
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

    init_builtin_templates(conn)?;

    Ok(())
}

fn init_builtin_templates(conn: &Connection) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare("SELECT COUNT(*) FROM templates WHERE is_builtin = 1")?;
    let count: i64 = stmt.query_row([], |row| row.get(0))?;
    if count > 0 {
        return Ok(());
    }

    let builtin_templates = vec![
        // 基础运算
        ("分数", "基础运算", "\\frac{a}{b}", 0),
        ("二次根号", "基础运算", "\\sqrt{x}", 1),
        ("n次根号", "基础运算", "\\sqrt[n]{x}", 2),
        ("指数", "基础运算", "x^{n}", 3),
        ("下标", "基础运算", "x_{i}", 4),

        // 微积分
        ("定积分", "微积分", "\\int_{a}^{b} f(x)\\,dx", 0),
        ("不定积分", "微积分", "\\int f(x)\\,dx", 1),
        ("极限", "微积分", "\\lim_{x \\to \\infty} f(x)", 2),
        ("一阶导数", "微积分", "\\frac{d}{dx}f(x)", 3),
        ("偏导数", "微积分", "\\frac{\\partial}{\\partial x}f(x,y)", 4),

        // 线性代数
        ("2x2矩阵", "线性代数", "\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}", 0),
        ("3x3矩阵", "线性代数", "\\begin{pmatrix} a & b & c \\\\ d & e & f \\\\ g & h & i \\end{pmatrix}", 1),
        ("行列式", "线性代数", "\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix}", 2),
        ("向量", "线性代数", "\\vec{v} = (v_1, v_2, v_3)", 3),
        ("矩阵乘法", "线性代数", "A_{m \\times n} \\cdot B_{n \\times p}", 4),

        // 概率统计
        ("求和", "概率统计", "\\sum_{i=1}^{n} x_i", 0),
        ("连乘", "概率统计", "\\prod_{i=1}^{n} x_i", 1),
        ("组合数", "概率统计", "\\binom{n}{k}", 2),
        ("平均数", "概率统计", "\\bar{x} = \\frac{1}{n}\\sum_{i=1}^{n}x_i", 3),
        ("标准差", "概率统计", "\\sigma = \\sqrt{\\frac{1}{n}\\sum_{i=1}^{n}(x_i-\\mu)^2}", 4),

        // 集合逻辑
        ("属于", "集合逻辑", "x \\in A", 0),
        ("子集", "集合逻辑", "A \\subseteq B", 1),
        ("并集", "集合逻辑", "A \\cup B", 2),
        ("交集", "集合逻辑", "A \\cap B", 3),
        ("空集", "集合逻辑", "\\varnothing", 4),
    ];

    let now = Utc::now();
    for (name, category, latex, sort_order) in &builtin_templates {
        let id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO templates (id, name, category, latex, created_at, use_count, sort_order, is_builtin) 
             VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, 1)",
            params![id, name, category, latex, now, sort_order],
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
