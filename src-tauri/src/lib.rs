//! Tempo desktop shell.
//!
//! The Rust side is deliberately thin: it owns the single SQLite connection
//! (WAL, foreign keys on) and exposes three generic data commands plus backup
//! management. All schema, migrations and business logic live in TypeScript so
//! the same code runs against sql.js in the browser dev/test driver.

mod lan;

use rusqlite::{backup::Backup, types::ValueRef, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Number, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager, State};

struct Db {
    conn: Mutex<Connection>,
    dir: PathBuf,
}

#[derive(Deserialize)]
struct Statement {
    sql: String,
    #[serde(default)]
    params: Vec<Value>,
}

#[derive(Serialize)]
struct BackupInfo {
    name: String,
    size: u64,
    modified_ms: u128,
}

type CmdResult<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn to_sql(v: &Value) -> rusqlite::types::Value {
    use rusqlite::types::Value as S;
    match v {
        Value::Null => S::Null,
        Value::Bool(b) => S::Integer(*b as i64),
        Value::Number(n) => n
            .as_i64()
            .map(S::Integer)
            .unwrap_or_else(|| S::Real(n.as_f64().unwrap_or(0.0))),
        Value::String(s) => S::Text(s.clone()),
        other => S::Text(other.to_string()),
    }
}

fn from_sql(v: ValueRef<'_>) -> Value {
    match v {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => Value::Number(i.into()),
        ValueRef::Real(f) => Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null),
        ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(_) => Value::Null,
    }
}

fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.busy_timeout(Duration::from_secs(5))?;
    Ok(conn)
}

fn run_select(conn: &Connection, sql: &str, params: &[Value]) -> rusqlite::Result<Vec<Value>> {
    let mut stmt = conn.prepare_cached(sql)?;
    let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let bound: Vec<rusqlite::types::Value> = params.iter().map(to_sql).collect();
    let mut rows = stmt.query(rusqlite::params_from_iter(bound))?;
    let mut out = Vec::new();
    while let Some(row) = rows.next()? {
        let mut obj = Map::with_capacity(names.len());
        for (i, name) in names.iter().enumerate() {
            obj.insert(name.clone(), from_sql(row.get_ref(i)?));
        }
        out.push(Value::Object(obj));
    }
    Ok(out)
}

fn run_execute(conn: &Connection, sql: &str, params: &[Value]) -> rusqlite::Result<usize> {
    let bound: Vec<rusqlite::types::Value> = params.iter().map(to_sql).collect();
    if bound.is_empty() && sql.matches(';').count() > 1 {
        // Multi-statement scripts (migrations) carry no parameters.
        conn.execute_batch(sql)?;
        return Ok(0);
    }
    conn.prepare_cached(sql)?.execute(rusqlite::params_from_iter(bound))
}

#[tauri::command]
fn db_select(db: State<'_, Db>, sql: String, params: Vec<Value>) -> CmdResult<Vec<Value>> {
    let conn = db.conn.lock().map_err(err)?;
    run_select(&conn, &sql, &params).map_err(err)
}

#[tauri::command]
fn db_execute(db: State<'_, Db>, sql: String, params: Vec<Value>) -> CmdResult<usize> {
    let conn = db.conn.lock().map_err(err)?;
    run_execute(&conn, &sql, &params).map_err(err)
}

/// Runs every statement inside one transaction; any failure rolls all of them back.
#[tauri::command]
fn db_batch(db: State<'_, Db>, statements: Vec<Statement>) -> CmdResult<()> {
    let mut conn = db.conn.lock().map_err(err)?;
    let tx = conn.transaction().map_err(err)?;
    for s in &statements {
        run_execute(&tx, &s.sql, &s.params).map_err(|e| format!("{e} — in: {}", s.sql))?;
    }
    tx.commit().map_err(err)
}

fn backups_dir(db: &Db) -> PathBuf {
    db.dir.join("backups")
}

fn safe_backup_path(db: &Db, name: &str) -> CmdResult<PathBuf> {
    if name.contains(['/', '\\']) || name.contains("..") || !name.ends_with(".db") {
        return Err("invalid backup name".into());
    }
    Ok(backups_dir(db).join(name))
}

/// Writes a consistent snapshot using SQLite's online backup API and prunes old ones.
#[tauri::command]
fn backup_create(db: State<'_, Db>, label: String, keep: usize) -> CmdResult<BackupInfo> {
    let dir = backups_dir(&db);
    fs::create_dir_all(&dir).map_err(err)?;
    let clean: String = label.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect();
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map_err(err)?.as_millis();
    let name = format!("tempo-{clean}-{stamp}.db");
    let path = dir.join(&name);
    {
        let conn = db.conn.lock().map_err(err)?;
        let mut dst = Connection::open(&path).map_err(err)?;
        let backup = Backup::new(&conn, &mut dst).map_err(err)?;
        backup.run_to_completion(64, Duration::from_millis(5), None).map_err(err)?;
    }
    // Prune: keep the newest `keep` automatic backups; manual ones are never pruned.
    if clean == "auto" && keep > 0 {
        let mut autos: Vec<PathBuf> = fs::read_dir(&dir)
            .map_err(err)?
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with("tempo-auto-")))
            .collect();
        autos.sort();
        while autos.len() > keep {
            let _ = fs::remove_file(autos.remove(0));
        }
    }
    let size = fs::metadata(&path).map_err(err)?.len();
    Ok(BackupInfo { name, size, modified_ms: stamp })
}

#[tauri::command]
fn backup_list(db: State<'_, Db>) -> CmdResult<Vec<BackupInfo>> {
    let dir = backups_dir(&db);
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut out = Vec::new();
    for entry in fs::read_dir(dir).map_err(err)? {
        let entry = entry.map_err(err)?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.ends_with(".db") {
            continue;
        }
        let meta = entry.metadata().map_err(err)?;
        let modified_ms = meta
            .modified()
            .ok()
            .and_then(|m| m.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis())
            .unwrap_or(0);
        out.push(BackupInfo { name, size: meta.len(), modified_ms });
    }
    out.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    Ok(out)
}

/// Replaces the live database with a backup. The backup is integrity-checked
/// first, and the current data is snapshotted so a bad restore can be undone.
#[tauri::command]
fn backup_restore(db: State<'_, Db>, name: String) -> CmdResult<()> {
    let src_path = safe_backup_path(&db, &name)?;
    let src = Connection::open_with_flags(&src_path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(err)?;
    let check: String = src.query_row("PRAGMA integrity_check", [], |r| r.get(0)).map_err(err)?;
    if check != "ok" {
        return Err(format!("backup failed integrity check: {check}"));
    }
    let mut conn = db.conn.lock().map_err(err)?;
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map_err(err)?.as_millis();
    {
        let mut safety = Connection::open(backups_dir(&db).join(format!("tempo-prerestore-{stamp}.db"))).map_err(err)?;
        Backup::new(&conn, &mut safety).map_err(err)?.run_to_completion(64, Duration::from_millis(5), None).map_err(err)?;
    }
    Backup::new(&src, &mut conn).map_err(err)?.run_to_completion(64, Duration::from_millis(5), None).map_err(err)?;
    Ok(())
}

#[tauri::command]
fn db_location(db: State<'_, Db>) -> String {
    db.dir.to_string_lossy().into_owned()
}

#[derive(Default)]
struct LanHost(Mutex<Option<lan::Hub>>);

#[derive(Clone, Serialize)]
struct LanEvent {
    kind: &'static str,
    conn: u64,
    text: String,
}

#[derive(Serialize)]
struct LanInfo {
    port: u16,
    /** addresses friends on the same network can use */
    addresses: Vec<String>,
}

/// Starts hosting for friends on the local network. Frames are forwarded to the webview as `lan-host` events.
#[tauri::command]
async fn lan_host_start(app: tauri::AppHandle, host: State<'_, LanHost>, port: u16) -> CmdResult<LanInfo> {
    if let Some(old) = host.0.lock().map_err(err)?.take() {
        old.stop();
    }
    let emitter = app.clone();
    let hub = lan::Hub::start(port, move |e| {
        let payload = match e {
            lan::HubEvent::Open(conn) => LanEvent { kind: "open", conn, text: String::new() },
            lan::HubEvent::Message(conn, text) => LanEvent { kind: "message", conn, text },
            lan::HubEvent::Close(conn) => LanEvent { kind: "close", conn, text: String::new() },
        };
        let _ = emitter.emit("lan-host", payload);
    })
    .await
    .map_err(|e| format!("Could not start hosting on port {port}: {e}"))?;
    let port = hub.port;
    let addresses = local_ip_address::list_afinet_netifas()
        .map(|list| list.into_iter().filter(|(_, ip)| ip.is_ipv4() && !ip.is_loopback()).map(|(_, ip)| format!("ws://{ip}:{port}")).collect())
        .unwrap_or_default();
    *host.0.lock().map_err(err)? = Some(hub);
    Ok(LanInfo { port, addresses })
}

#[tauri::command]
fn lan_host_send(host: State<'_, LanHost>, conn: u64, text: String) -> CmdResult<()> {
    if let Some(hub) = host.0.lock().map_err(err)?.as_ref() {
        hub.send(conn, text);
    }
    Ok(())
}

#[tauri::command]
fn lan_host_stop(host: State<'_, LanHost>) -> CmdResult<()> {
    if let Some(hub) = host.0.lock().map_err(err)?.take() {
        hub.stop();
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(LanHost::default())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            fs::create_dir_all(&dir)?;
            let conn = open(&dir.join("tempo.db"))?;
            app.manage(Db { conn: Mutex::new(conn), dir });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db_select,
            db_execute,
            db_batch,
            backup_create,
            backup_list,
            backup_restore,
            db_location,
            lan_host_start,
            lan_host_send,
            lan_host_stop
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tempo");
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn roundtrip_and_types() {
        let conn = Connection::open_in_memory().unwrap();
        run_execute(&conn, "CREATE TABLE t (a TEXT, b INTEGER, c REAL); CREATE TABLE u (x);", &[]).unwrap();
        run_execute(&conn, "INSERT INTO t VALUES (?,?,?)", &[json!("x"), json!(true), json!(1.5)]).unwrap();
        let rows = run_select(&conn, "SELECT * FROM t", &[]).unwrap();
        assert_eq!(rows, vec![json!({"a": "x", "b": 1, "c": 1.5})]);
    }
}
