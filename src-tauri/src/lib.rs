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
            export_png,
            batch_recognize,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
