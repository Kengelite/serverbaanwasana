const express = require("express");
const { exec, spawn } = require("child_process");
const fs = require("fs");
const cors = require("cors");
const path = require("path");
const mysql = require("mysql2/promise");
const { v4: uuidv4 } = require("uuid");
require("dotenv").config(); 
const app = express();
const PORT = process.env.PORT || 5005;
app.use(cors());
app.use(express.json());

const pool = mysql.createPool({
  host: process.env.DB_HOST, // ใช้ค่าจาก .env
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT, 10), // แปลงเป็นตัวเลข
  queueLimit: parseInt(process.env.DB_QUEUE_LIMIT, 10), // แปลงเป็นตัวเลข
});


async function getConnection() {
  try {
    return await pool.getConnection();
  } catch (err) {
    console.error("Error getting a connection from the pool:", err);
    throw err;
  }
}
app.get("/dataindex_all", async (req, res) => {
  connection = await pool.getConnection();
  try {
    const [rows] = await connection.execute(`
      select * from flowers
      `);
    const [rows_total] = await connection.execute(`
        select count(*) as total from flowers
        `);
    res.json({ data: rows, total: rows_total });
  } catch (err) {
    res.status(500).send("Can't get Data request");
  }
});

app.get("/getDatabestseller", async (req, res) => {
  connection = await pool.getConnection();
  let type = req.query.select_type;
  // console.log(type)
  try {
    let rows; // ตัวแปรสำหรับเก็บผลลัพธ์จาก query
    let rows_total; // ตัวแปรสำหรับเก็บผลรวมจาก query

    if (type === 1) {
      // ใช้ === เพื่อตรวจสอบชนิดข้อมูลอย่างเคร่งครัด
      [rows] = await connection.execute(`
        SELECT id_bflower,price,name_code,url_image,description FROM bunch_flowers
      `);
      [rows_total] = await connection.execute(`
        SELECT COUNT(*) AS total FROM bunch_flowers
      `);
    } else if (type == 2) {
      [rows] = await connection.execute(`
        SELECT id_bflower,price,name_code,url_image,description FROM bunch_flowers
        ORDER BY price ASC;
      `);
      [rows_total] = await connection.execute(`
        SELECT COUNT(*) AS total FROM bunch_flowers
      `);
    } else {
      [rows] = await connection.execute(`
        SELECT id_bflower,price,name_code,url_image,description FROM bunch_flowers
        ORDER BY price DESC;
      `);

      [rows_total] = await connection.execute(`
        SELECT COUNT(*) AS total FROM bunch_flowers
      `);
    }

    res.json({ data: rows, total: rows_total });
  } catch (err) {
    res.status(500).send("Can't get Data request");
  } finally {
    connection.release(); // ปล่อย connection กลับไปที่ pool
  }
});

app.get("/users", async (req, res) => {
  try {
    const [rows] = await pool.execute("SELECT * FROM user");
    res.json(rows);
  } catch (error) {
    console.error("Error executing query:", error);
    res.status(500).send("Error retrieving data");
  }
});

app.get("/", (req, res) => {
  res.send("Hello Backend!");
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});