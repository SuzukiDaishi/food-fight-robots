use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RobotRecord {
    pub id: String,
    pub name: String,
    pub lore: String,
    pub hp: i32,
    pub atk: i32,
    pub def: i32,
    pub original_image_path: String,
    pub image_path: String,
    pub model_path: String,
    pub attack_model_path: String,
    pub created_at: i64,
    pub generation_time_ms: i64,
}

pub fn init_db(db_path: &std::path::Path) -> Result<Connection> {
    let conn = Connection::open(db_path)?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS robots (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            lore TEXT NOT NULL,
            hp INTEGER NOT NULL,
            atk INTEGER NOT NULL,
            def INTEGER NOT NULL,
            original_image_path TEXT NOT NULL,
            image_path TEXT NOT NULL,
            model_path TEXT NOT NULL,
            attack_model_path TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            generation_time_ms INTEGER NOT NULL
        )",
        [],
    )?;

    Ok(conn)
}

pub fn insert_robot(conn: &Connection, robot: &RobotRecord) -> Result<()> {
    conn.execute(
        "INSERT INTO robots (id, name, lore, hp, atk, def, original_image_path, image_path, model_path, attack_model_path, created_at, generation_time_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            robot.id,
            robot.name,
            robot.lore,
            robot.hp,
            robot.atk,
            robot.def,
            robot.original_image_path,
            robot.image_path,
            robot.model_path,
            robot.attack_model_path,
            robot.created_at,
            robot.generation_time_ms,
        ],
    )?;
    Ok(())
}

pub fn get_robots(conn: &Connection) -> Result<Vec<RobotRecord>> {
    let mut stmt =
        conn.prepare("SELECT id, name, lore, hp, atk, def, original_image_path, image_path, model_path, attack_model_path, created_at, generation_time_ms FROM robots")?;
    let robot_iter = stmt.query_map([], |row| {
        Ok(RobotRecord {
            id: row.get(0)?,
            name: row.get(1)?,
            lore: row.get(2)?,
            hp: row.get(3)?,
            atk: row.get(4)?,
            def: row.get(5)?,
            original_image_path: row.get(6)?,
            image_path: row.get(7)?,
            model_path: row.get(8)?,
            attack_model_path: row.get(9)?,
            created_at: row.get(10)?,
            generation_time_ms: row.get(11)?,
        })
    })?;

    let mut robots = Vec::new();
    for robot in robot_iter {
        robots.push(robot?);
    }
    Ok(robots)
}
