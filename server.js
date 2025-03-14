const express = require("express");
const { exec, spawn } = require("child_process");
const fs = require("fs");
const cors = require("cors");
const path = require("path");
const mysql = require("mysql2/promise");
const { v4: uuidv4 } = require("uuid");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const { inspector } = require("inspector");
require("dotenv").config();
const crypto = require("crypto");
const app = express();
const PORT = process.env.PORT || 5005;
app.use(cors());
app.use(express.json());
const bcrypt = require("bcryptjs");
const pool = mysql.createPool({
  host: process.env.DB_HOST, // ใช้ค่าจาก .env
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT, 10), // แปลงเป็นตัวเลข
  queueLimit: parseInt(process.env.DB_QUEUE_LIMIT, 10), // แปลงเป็นตัวเลข
});

const uploadDir_payment = path.join(__dirname, "assets/payment");
if (!fs.existsSync(uploadDir_payment)) {
  fs.mkdirSync(uploadDir_payment, { recursive: true }); // สร้างโฟลเดอร์ถ้ายังไม่มี
}
const storage_payment = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir_payment);
  },

  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const filename = `${new Date()
      .toISOString()
      .replace(/[:.-]/g, "")}_${uuidv4()}${ext}`;
    cb(null, filename);
  },
});
const upload_payment = multer({ storage: storage_payment });
// 📌 กำหนดโฟลเดอร์สำหรับเก็บไฟล์
const uploadDir = path.join(__dirname, "assets/image_all");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true }); // สร้างโฟลเดอร์ถ้ายังไม่มี
}
// 📌 ตั้งค่า `multer` สำหรับอัปโหลดไฟล์
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },

  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const filename = `${new Date()
      .toISOString()
      .replace(/[:.-]/g, "")}_${uuidv4()}${ext}`;
    cb(null, filename);
  },
});

const upload = multer({ storage });

async function getConnection() {
  try {
    return await pool.getConnection();
  } catch (err) {
    console.error("Error getting a connection from the pool:", err);
    throw err;
  }
}

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // ดึง token ออกจาก "Bearer <token>"
  // console.log(token);
  if (!token) {
    return res.status(401).json({ status: false, message: "Token is missing" });
  }
  try {
    // ยืนยัน token
    const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
    req.user = decoded; // เก็บข้อมูลผู้ใช้จาก token ไว้ใน req
    next(); // ดำเนินการต่อ
  } catch (err) {
    return res.status(403).json({ status: false, message: "Invalid Token" });
  }
};

app.get("/dataindex_all", async (req, res) => {
  const connection = await getConnection();
  try {
    const [rows] = await connection.execute(`
      select * from flowers
      `);
    const [rows_total] = await connection.execute(`
        select count(*) as total from flowers
        `);

    [rows_best] = await connection.execute(`
     SELECT 
    bf.id_bflower AS id, 
    bf.name_code AS name, 
    bf.price, 
    MIN(img.url_image) AS url_image
FROM 
    bunch_flowers AS bf
LEFT JOIN 
    image_all AS img 
ON 
    bf.id_bflower = img.id_bflower 
WHERE 
    bf.delete_up IS NULL and status_flowers = 1 and img.delete_at IS NULL -- แก้ไขให้ตรวจสอบในตารางที่มีจริง
GROUP BY 
    bf.id_bflower
LIMIT 10;
      ;
        `);
    [rows_flower] = await connection.execute(`
      SELECT 
      name , meaning ,url_image
  from flowers
  WHERE 
    flowers.delete_up IS NULL
  limit 4
  ;
    `);

    res.json({
      data: rows,
      total: rows_total,
      data_best: rows_best,
      data_flower: rows_flower,
    });
  } catch (err) {
    res.status(500).send("Can't get Data request");
  } finally {
    connection.release(); // ปล่อย connection กลับไปที่ pool
  }
});

app.get("/getDatabestseller", async (req, res) => {
  const connection = await getConnection();
  let type = req.query.select_type;
  console.log(type);
  // console.log(type)
  try {
    let rows; // ตัวแปรสำหรับเก็บผลลัพธ์จาก query
    let rows_total; // ตัวแปรสำหรับเก็บผลรวมจาก query

    [rows] = await connection.execute(`
    SELECT 
   bf.id_bflower AS id, 
   bf.name_code AS name, 
   bf.price, 
   MIN(img.url_image) AS url_image,
   COALESCE(SUM(bdf.amount), 0) AS total_sold  -- ยอดขายรวมของแต่ละสินค้า
FROM 
   bunch_flowers AS bf
LEFT JOIN 
   image_all AS img 
   ON bf.id_bflower = img.id_bflower 
LEFT JOIN 
   bill_detail_flower AS bdf 
   ON bf.id_bflower = bdf.id_bflower  -- เชื่อมกับตารางรายละเอียดใบเสร็จ
LEFT JOIN 
   bill_flower AS bf_bill 
   ON bdf.bill_id_flower = bf_bill.id_bill_flower AND bf_bill.status = 1  -- นับเฉพาะออเดอร์ที่ชำระเงินแล้ว
WHERE 
   bf.delete_up IS NULL  
   AND bf.status_flowers = 1  
   AND img.delete_at IS NULL
GROUP BY 
   bf.id_bflower
ORDER BY 
   total_sold DESC  -- เรียงจากสินค้าขายดีมากไปน้อย
LIMIT 20;
     `);
    [rows_total] = await connection.execute(`
       SELECT COUNT(*) AS total FROM 
   bunch_flowers AS bf
LEFT JOIN 
   image_all AS img 
   ON bf.id_bflower = img.id_bflower 
LEFT JOIN 
   bill_detail_flower AS bdf 
   ON bf.id_bflower = bdf.id_bflower  -- เชื่อมกับตารางรายละเอียดใบเสร็จ
LEFT JOIN 
   bill_flower AS bf_bill 
   ON bdf.bill_id_flower = bf_bill.id_bill_flower AND bf_bill.status = 1  -- นับเฉพาะออเดอร์ที่ชำระเงินแล้ว
WHERE 
   bf.delete_up IS NULL  
   AND bf.status_flowers = 1  
   AND img.delete_at IS NULL
LIMIT 20;
     `);
    res.json({ data: rows, total: rows_total });
  } catch (err) {
    res.status(500).send("Can't get Data request");
  } finally {
    connection.release(); // ปล่อย connection กลับไปที่ pool
  }
});

app.get("/getDataBunch", async (req, res) => {
  const connection = await getConnection();

  // console.log(type)
  try {
    let rows; // ตัวแปรสำหรับเก็บผลลัพธ์จาก query
    let rows_total; // ตัวแปรสำหรับเก็บผลรวมจาก query

    [rows] = await connection.execute(`
SELECT 
   bf.id_bflower AS id, 
   bf.name_code AS name, 
   bf.price, 
   MIN(img.url_image) AS url_image
FROM 
   bunch_flowers AS bf
LEFT JOIN 
   image_all AS img 
   ON bf.id_bflower = img.id_bflower 
WHERE 
   bf.delete_up IS NULL  
   AND bf.status_flowers = 1  
   AND img.delete_at IS NULL
GROUP BY 
   bf.id_bflower
ORDER BY 
   bf.name_code ASC;  -- เรียงตามชื่อสินค้า
     `);
    [rows_total] = await connection.execute(`
       SELECT COUNT(*) AS total FROM bunch_flowers
       WHERE 
   bunch_flowers.delete_up IS NULL
     `);
    res.json({ data: rows, total: rows_total });
  } catch (err) {
    res.status(500).send("Can't get Data request");
  } finally {
    connection.release(); // ปล่อย connection กลับไปที่ pool
  }
});

app.get("/getDataBunchChane", async (req, res) => {
  const connection = await getConnection();
  let type = req.query.select_type;
  console.log(type);
  // console.log(type)
  try {
    let rows; // ตัวแปรสำหรับเก็บผลลัพธ์จาก query
    let rows_total; // ตัวแปรสำหรับเก็บผลรวมจาก query

    [rows] = await connection.execute(
      `
SELECT 
   bf.id_bflower AS id, 
   bf.name_code AS name, 
   bf.price, 
   MIN(img.url_image) AS url_image
FROM 
   bunch_flowers AS bf
LEFT JOIN 
   image_all AS img 
   ON bf.id_bflower = img.id_bflower 
WHERE 
   bf.delete_up IS NULL  
   AND bf.status_flowers = 1  
   AND img.delete_at IS NULL
   and chance_id = ?
GROUP BY 
   bf.id_bflower
ORDER BY 
   bf.name_code ASC;  -- เรียงตามชื่อสินค้า
     `,
      [type]
    );
    [rows_total] = await connection.execute(
      `
       SELECT COUNT(*) AS total FROM 
   bunch_flowers AS bf
LEFT JOIN 
   image_all AS img 
   ON bf.id_bflower = img.id_bflower 
WHERE 
   bf.delete_up IS NULL  
   AND bf.status_flowers = 1  
   AND img.delete_at IS NULL
   and chance_id = ?
ORDER BY 
   bf.name_code ASC;
     `,
      [type]
    );
    console.log(rows);
    res.json({ data: rows, total: rows_total });
  } catch (err) {
    res.status(500).send("Can't get Data request");
  } finally {
    connection.release(); // ปล่อย connection กลับไปที่ pool
  }
});

app.get("/getDataTypeChane", async (req, res) => {
  const connection = await getConnection();
  let type = req.query.select_type;
  let choose = req.query.choose;
  console.log(type);
  // console.log(type)
  try {
    let rows; // ตัวแปรสำหรับเก็บผลลัพธ์จาก query
    let rows_total; // ตัวแปรสำหรับเก็บผลรวมจาก query

    if (choose == 1) {
      [rows] = await connection.execute(
        `
SELECT 
   bf.id_bflower AS id, 
   bf.name_code AS name, 
   bf.price, 
   MIN(img.url_image) AS url_image
FROM 
   bunch_flowers AS bf
LEFT JOIN 
   image_all AS img 
   ON bf.id_bflower = img.id_bflower 
WHERE 
   bf.delete_up IS NULL  
   AND bf.status_flowers = 1  
   AND img.delete_at IS NULL
   and scalar_id = ?
GROUP BY 
   bf.id_bflower
ORDER BY 
   bf.name_code ASC;  -- เรียงตามชื่อสินค้า
     `,
        [type]
      );
      [rows_total] = await connection.execute(
        `
       SELECT COUNT(*) AS total FROM 
   bunch_flowers AS bf
LEFT JOIN 
   image_all AS img 
   ON bf.id_bflower = img.id_bflower 
WHERE 
   bf.delete_up IS NULL  
   AND bf.status_flowers = 1  
   AND img.delete_at IS NULL
   and scalar_id = ?
ORDER BY 
   bf.name_code ASC;
     `,
        [type]
      );
    } else if (choose == 2) {
      [rows] = await connection.execute(
        `
SELECT 
   bf.id_bflower AS id, 
   bf.name_code AS name, 
   bf.price, 
   MIN(img.url_image) AS url_image
FROM 
   bunch_flowers AS bf
LEFT JOIN 
   image_all AS img 
   ON bf.id_bflower = img.id_bflower 
WHERE 
   bf.delete_up IS NULL  
   AND bf.status_flowers = 1  
   AND img.delete_at IS NULL
   and typef_id = ?
GROUP BY 
   bf.id_bflower
ORDER BY 
   bf.name_code ASC;  -- เรียงตามชื่อสินค้า
     `,
        [type]
      );
      [rows_total] = await connection.execute(
        `
       SELECT COUNT(*) AS total FROM 
   bunch_flowers AS bf
LEFT JOIN 
   image_all AS img 
   ON bf.id_bflower = img.id_bflower 
WHERE 
   bf.delete_up IS NULL  
   AND bf.status_flowers = 1  
   AND img.delete_at IS NULL
   and typef_id = ?
ORDER BY 
   bf.name_code ASC;
     `,
        [type]
      );
    }
    console.log(rows);
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
  } finally {
    connection.release(); // ปล่อย connection กลับไปที่ pool
  }
});

app.post("/select_detail_flower", async (req, res) => {
  const connection = await getConnection();
  let select_id_flower = req.body.id_select;
  // console.log(select_id_flower)
  try {
    const [rows_img] = await pool.execute(
      `SELECT img.url_image as url FROM bunch_flowers  as bf
LEFT JOIN 
    image_all AS img 
ON 
    bf.id_bflower = img.id_bflower
where bf.id_bflower  = ?  and img.delete_at IS NULL and
    bf.delete_up IS NULL and status_flowers = 1
      `,
      [select_id_flower]
    );
    const [rows_data] = await pool.execute(
      `SELECT   bf.id_bflower, 
        bf.name_code, 
        bf.price, 
        bf.description
    FROM bunch_flowers  as bf
    where bf.id_bflower  = ?
    and 
    bf.delete_up IS NULL and status_flowers = 1
      `,
      [select_id_flower]
    );
    // console.log(rows)
    res.json({ data_img: rows_img, data: rows_data });
  } catch (error) {
    console.error("Error executing query:", error);
    res.status(500).send("Error retrieving data");
  } finally {
    connection.release(); // ปล่อย connection กลับไปที่ pool
  }
});
app.get("/datainvolve", async (req, res) => {
  const connection = await getConnection();
  try {
    const [rows] = await connection.execute(`
      select * from flowers
      where 
    flowers.delete_up IS NULL
      `);
    const [rows_total] = await connection.execute(`
        select count(*) as total from flowers
           where 
    flowers.delete_up IS NULL
        `);

    [rows_best] = await connection.execute(`
          SELECT 
      bf.id_bflower as id, 
      bf.name_code as name, 
      bf.price , 
      MIN(img.url_image) AS url_image
  FROM 
      bunch_flowers AS bf
  LEFT JOIN 
      image_all AS img 
  ON 
      bf.id_bflower = img.id_bflower
  where 
    bf.delete_up IS NULL and status_flowers = 1
  GROUP BY 
      bf.id_bflower
      limit 10
      ;
        `);
    res.json({ data: rows, total: rows_total, data_best: rows_best });
  } catch (err) {
    res.status(500).send("Can't get Data request");
  } finally {
    connection.release(); // ปล่อย connection กลับไปที่ pool
  }
});

app.post("/check-login", async (req, res) => {
  let connection;
  const { email, pwd } = req.body;

  try {
    connection = await getConnection();
    // ดึงข้อมูลผู้ใช้จากฐานข้อมูล
    const [rows] = await connection.execute(
      `SELECT id_uc as id, email, role, nname as nickname, pwd FROM user_customers
      WHERE email = ? AND user_customers.delete_up IS NULL`,
      [email]
    );

    if (rows.length > 0) {
      const user = rows[0];

      // ตรวจสอบรหัสผ่านที่กรอกกับแฮชในฐานข้อมูล
      const isPasswordCorrect = await bcrypt.compare(pwd, user.pwd);

      if (!isPasswordCorrect) {
        return res
          .status(401)
          .json({ status: false, message: "Invalid credentials" });
      }

      // ถ้ารหัสผ่านถูกต้อง, สร้าง token
      const payload = {
        id: user.id,
        nickname: user.nickname,
        role: user.role,
      };

      const token = jwt.sign(payload, process.env.JWT_SECRET_KEY, {
        expiresIn: "1d",
      });

      res.json({
        status: true,
        token,
        id: user.id,
        role: user.role,
        nickname: user.nickname,
      });
    } else {
      res.status(401).json({ status: false, message: "Invalid credentials" });
    }
  } catch (err) {
    console.error("Error checking login:", err);
    res.status(500).json({ status: false, message: "Server error" });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

app.put("/register", async (req, res) => {
  let connection;
  const { email, pwd, fname, lname, nname, tel } = req.body.formData;

  try {
    connection = await getConnection();

    // ตรวจสอบว่ามีผู้ใช้ที่ใช้อีเมลนี้อยู่แล้วหรือไม่
    const [existingUser] = await connection.execute(
      `SELECT id_uc FROM user_customers WHERE email = ? and  
      user_customers.delete_up IS NULL`,
      [email]
    );

    if (existingUser.length > 0) {
      return res
        .status(400)
        .json({ status: false, message: "อีเมลนี้ถูกใช้งานไปแล้ว" });
    }

    // แฮชรหัสผ่านด้วย bcryptjs
    const salt = await bcrypt.genSalt(10); // ใช้ cost factor 10
    const hashedPassword = await bcrypt.hash(pwd, salt); // แฮชรหัสผ่านที่ผู้ใช้กรอก

    // เพิ่มข้อมูลผู้ใช้ใหม่ โดยใช้รหัสผ่านที่แฮชแล้ว
    await connection.execute(
      `INSERT INTO user_customers (id_uc, email, pwd, fname, lname, nname, tel) 
       VALUES (uuid(), ?, ?, ?, ?, ?, ?)`,
      [email, hashedPassword, fname, lname, nname, tel] // เก็บรหัสผ่านที่แฮชแล้ว
    );

    // รับ ID ผู้ใช้ใหม่ที่เพิ่งเพิ่ม
    const [newUser] = await connection.execute(
      `SELECT id_uc as id, email, role, nname as nickname 
       FROM user_customers WHERE email = ? and  
      user_customers.delete_up IS NULL`,
      [email]
    );

    const user = newUser[0];
    const payload = { id: user.id, nickname: user.nickname, role: user.role };

    // สร้าง token
    const token = jwt.sign(payload, process.env.JWT_SECRET_KEY, {
      expiresIn: "1d",
    });

    res.json({
      status: true,
      message: "สมัครสมาชิกสำเร็จ",
      token,
      id: user.id,
      role: user.role,
      nickname: user.nickname,
    });
  } catch (err) {
    console.error("Error during registration:", err);
    res.status(500).json({ status: false, message: "Server error" });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

app.post("/add_user", authenticateToken, async (req, res) => {
  const connection = await getConnection();
  try {
    const { email, pwd, fname, lname, nname, tel } = req.body.userdata;
    console.log(req.body);
    const [existingUser] = await connection.execute(
      `SELECT id_uc FROM user_customers WHERE email = ? and  
      user_customers.delete_up IS NULL`,
      [email]
    );

    if (existingUser.length > 0) {
      return res
        .status(400)
        .json({ status: false, message: "อีเมลนี้ถูกใช้งานไปแล้ว" });
    }

    // แฮชรหัสผ่านด้วย bcryptjs
    const salt = await bcrypt.genSalt(10); // ใช้ cost factor 10
    const hashedPassword = await bcrypt.hash(pwd, salt); // แฮชรหัสผ่านที่ผู้ใช้กรอก

    // เพิ่มข้อมูลผู้ใช้ใหม่ โดยใช้รหัสผ่านที่แฮชแล้ว
    const [newUser] = await connection.execute(
      `INSERT INTO user_customers (id_uc, email, pwd, fname, lname, nname, tel) 
       VALUES (uuid(), ?, ?, ?, ?, ?, ?)`,
      [email, hashedPassword, fname, lname, nname, tel] // เก็บรหัสผ่านที่แฮชแล้ว
    );

    // รับ ID ผู้ใช้ใหม่ที่เพิ่งเพิ่ม
    // const [newUser] = await connection.execute(
    //   `SELECT id_uc as id, email, role, nname as nickname
    //    FROM user_customers WHERE email = ? and
    //   user_customers.delete_up IS NULL`,
    //   [email]
    // );
    // console.log(updateResult)
    connection.release();

    if (newUser.affectedRows > 0) {
      res.json({ status: true, message: "เพิ่มข้อมูลสำเร็จ" });
    } else {
      res.json({
        status: false,
        message: "ไม่พบข้อมูลหรือไม่มีการเปลี่ยนแปลง",
      });
    }
  } catch (err) {
    console.error("Error updating data:", err);
    res.status(500).json({ status: false, message: "Server error" });
  } finally {
    connection.release(); // ปล่อย connection กลับไปที่ pool
  }
});

app.post("/update_user", authenticateToken, async (req, res) => {
  const connection = await getConnection();
  try {
    const { email, pwd, fname, lname, nname, tel, id } =
      req.body.userdata || {};
    // const id_bflower = req.body.id_bflower;
    // console.log(id_choose);

    if (req.body.choose == 1) {
      const salt = await bcrypt.genSalt(10); // ใช้ cost factor 10
      const hashedPassword = await bcrypt.hash(pwd, salt); // แฮชรหัสผ่านที่ผู้ใช้กรอก

      const [updateResult] = await connection.execute(
        `UPDATE user_customers 
         SET email = ?, pwd = ?, fname = ?, lname = ?, nname = ?, tel = ? 
         WHERE id_uc = ?`,
        [email, hashedPassword, fname, lname, nname, tel, id] // Update existing user by ID
      );
      // console.log(updateResult)
      connection.release();
      if (updateResult.affectedRows > 0) {
        res.json({ status: true, message: "อัปเดตข้อมูลสำเร็จ" });
      } else {
        res.json({
          status: false,
          message: "ไม่พบข้อมูลหรือไม่มีการเปลี่ยนแปลง",
        });
      }
    } else {
      const [updateResult] = await connection.execute(
        `UPDATE user_customers 
         SET email = ?, fname = ?, lname = ?, nname = ?, tel = ? 
         WHERE id_uc = ?`,
        [email, fname, lname, nname, tel, id] // Update existing user by ID
      );
      // console.log(updateResult)
      connection.release();
      if (updateResult.affectedRows > 0) {
        res.json({ status: true, message: "อัปเดตข้อมูลสำเร็จ" });
      } else {
        res.json({
          status: false,
          message: "ไม่พบข้อมูลหรือไม่มีการเปลี่ยนแปลง",
        });
      }
    }
  } catch (err) {
    console.error("Error updating data:", err);
    res.status(500).json({ status: false, message: "Server error" });
  } finally {
    connection.release(); // ปล่อย connection กลับไปที่ pool
  }
});

app.post("/profile", authenticateToken, async (req, res) => {
  const connection = await getConnection();
  try {
    const userId = req.body.userId; // ดึง user id จาก token

    // console.log(userId);
    const [user] = await connection.execute(
      `SELECT id_uc, fname, lname, email, nname,pwd, tel FROM user_customers WHERE id_uc = ? and  
    user_customers.delete_up IS NULL`,
      [userId]
    );

    if (user.length === 0) {
      return res.status(404).json({ status: false, message: "User not found" });
    }

    res.json({
      status: true,
      data: user[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: false, message: "Server error" });
  } finally {
    connection.release(); // ปล่อย connection กลับไปที่ pool
  }
});

app.post("/update_profile", async (req, res) => {
  const connection = await getConnection();
  console.log("Received request body:", req.body);
  try {
    // Retrieve user data from request body

    const { id_uc, fname, lname, tel, nname } = req.body;

    if (!id_uc || !fname || !lname || !tel || !nname) {
      console.log("Missing required fields in the request body");
      return res
        .status(400)
        .json({ status: false, message: "Missing fieldshhhh" });
    }

    // Hash the password using MD5
    // const passwordHash = crypto.createHash("md5").update(password).digest("hex");

    // Update user information in the `user_customers` table
    const result = await connection.execute(
      `UPDATE user_customers
       SET fname = ?, lname = ?, tel = ?, nname = ?
       WHERE id_uc = ?`,
      [
        fname,
        lname,
        tel,
        nname,
        // passwordHash,
        id_uc, // User ID from the request
      ]
    );

    console.log("Profile updated successfully:", result);
    res.json({ status: true, message: "Profile updated successfully" });
  } catch (err) {
    console.error("Error occurred:", err.message);
    res.status(500).json({ status: false, message: err.message });
  } finally {
    connection.release();
  }
});

app.post("/update_Passwordprofile", async (req, res) => {
  const connection = await getConnection();
  console.log("Received request body:", req.body);
  try {
    // Retrieve user data from request body
    const password = req.body.password;
    const id_uc = req.body.id_uc;

    console.log(req.body);
    if (!id_uc || !password) {
      console.log("Missing required fields in the request body");
      return res.status(400).json({ status: false, message: "Missing fields" });
    }

    // Hash the password using bcryptjs
    const salt = await bcrypt.genSalt(10); // Generate salt with cost factor of 10
    const passwordHash = await bcrypt.hash(password, salt);
    console.log(passwordHash);

    // Update user information in the `user_customers` table
    const result = await connection.execute(
      `UPDATE user_customers
       SET pwd = ?
       WHERE id_uc = ?`,
      [passwordHash, id_uc] // Use the hashed password and user ID from the request
    );

    console.log("Profile updated successfully:", result);
    res.json({
      status: true,
      message: "Profile updated successfully",
      passhash: passwordHash,
    });
  } catch (err) {
    console.error("Error occurred:", err.message);
    res.status(500).json({ status: false, message: err.message });
  } finally {
    connection.release();
  }
});

app.post("/insert_profile", authenticateToken, async (req, res) => {
  const connection = await getConnection();
  try {
    console.log(req.body);

    let user_id = req.body.user_id;

    let recieve = JSON.parse(req.body.recieve || "[]");
    console.log("Parsed recieve:", recieve);
    const { fname, lname, tel, street, txt_address, zip } = recieve[0] || {};
    // บันทึกที่อยู่การจัดส่ง
    await connection.execute(
      `INSERT INTO send_flowers (id_send_flowers, fname, lname, tel, txt_address, street, district, subdistrict, province, zip_code) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [send_uuid, fname, lname, tel, txt_address, street, zip]
    );
    res.json({ status: true });
  } catch (err) {
    console.error("Error occurred:", err.message);
    res.status(500).json({ status: false, message: "Server error" });
  } finally {
    connection.release();
  }
});

app.post("/payment", async (req, res) => {
  const connection = await getConnection();
  try {
    // console.log(userId);
    // let select_id_flower = req.body.id_select;
    const [row_data] = await connection.execute(
      `SELECT id,name_bank,image FROM payment WHERE 
    payment.delete_up IS NULL`
    );
    if (row_data.length === 0) {
      return res.status(404).json({ status: false, message: "User not found" });
    }

    res.json({
      status: true,
      data: row_data,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: false, message: "Server error" });
  } finally {
    connection.release(); // ปล่อย connection กลับไปที่ pool
  }
});
app.post(
  "/payment_insert_bill",
  upload_payment.single("image"),
  authenticateToken,
  async (req, res) => {
    const connection = await getConnection();
    try {
      console.log(req.body);

      let user_id = req.body.user_id;

      let recieve = JSON.parse(req.body.recieve || "[]");
      console.log("Parsed recieve:", recieve);
      const { fname, lname, tel, street, txt_address, zip } = recieve[0] || {};

      let Address = JSON.parse(req.body.Address || "[]");
      console.log("Parsed Address:", Address);
      const { district, province, subdistrict } = Address[0] || {};

      // let send_txt = JSON.parse(req.body.send_txt || "[]");
      // console.log("Parsed send_txt:", send_txt);
      // const { txt_send } = send_txt[0] || {};

      let cart = JSON.parse(req.body.cart || "[]");
      console.log("Parsed cart:", cart);

      if (!cart.length) {
        return res
          .status(400)
          .json({ status: false, message: "Cart is empty" });
      }

      // อัปโหลดไฟล์ภาพการชำระเงิน
      const imageUrl = `/assets/payment/${req.file.filename}`;
      console.log("✅ File Uploaded:", imageUrl);

      // สร้างเลขออเดอร์
      const prefix = "ORD16735";
      const timestamp = Date.now();
      let id_txt_order = prefix + timestamp;

      // UUID สำหรับการส่งของ
      let send_uuid = uuidv4();

      // บันทึกที่อยู่การจัดส่ง
      await connection.execute(
        `INSERT INTO send_flowers (id_send_flowers, fname, lname, tel, txt_address, street, district, subdistrict, province, zip_code) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          send_uuid,
          fname,
          lname,
          tel,
          txt_address,
          street,
          district,
          subdistrict,
          province,
          zip,
        ]
      );

      // ตรวจสอบว่ามี `bill_flower` ที่ `status = 0` อยู่หรือไม่
      const [existingBills] = await connection.execute(
        `SELECT id_bill_flower FROM bill_flower WHERE user_customers_id = ? AND status = 0 LIMIT 1`,
        [user_id]
      );

      let newUUID_bill;
      let total_payment = cart.reduce(
        (sum, item) => sum + item.price * item.amount,
        0
      ); // คำนวณราคารวมทั้งหมด

      if (existingBills.length > 0) {
        // ❗ ถ้ามี `bill_flower` ที่ status = 0 ❗
        oldUUID_bill = existingBills[0].id_bill_flower; // ใช้บิลเดิม

        newUUID_bill = uuidv4();

        // บันทึกบิลใหม่
        await connection.execute(
          `INSERT INTO bill_flower (id_bill_flower, txt_id_order, user_customers_id, status, url_payment, total_payment, send_flowers_id) 
           VALUES (?, ?, ?, 1, ?, ?, ?)`,
          [
            newUUID_bill,
            id_txt_order,
            user_id,
            imageUrl,
            total_payment,
            send_uuid,
          ]
        );
        for (const item of cart) {
          if (item.choose === "2") {
            // 🔄 ตรวจสอบว่าสินค้าตรงกับบิลที่มีอยู่ และอัปเดตให้เป็นบิลใหม่
            console.log(item.id_product);
            console.log("🔄 อัปเดตสินค้าที่อยู่ในบิลเดิม:", oldUUID_bill);
            console.log("✅ สร้างบิลใหม่:", newUUID_bill);
            await connection.execute(
              `UPDATE bill_detail_flower SET bill_id_flower = ? WHERE id_detail_flower = ? `,
              [newUUID_bill, item.id_product]
            );
          } else {
            // 🔄 เพิ่มสินค้าใหม่ในบิลปัจจุบัน
            await connection.execute(
              `INSERT INTO bill_detail_flower (id_detail_flower, bill_id_flower, id_bflower, amount, price, txt_send_flower) 
               VALUES (uuid(), ?, ?, ?, ?, ?)`,
              [
                newUUID_bill,
                item.id_product,
                item.amount,
                item.price,
                item.txt_send,
              ]
            );
          }
        }
      } else {
        // ❗ ถ้าไม่มี `bill_flower` ที่ status = 0 ❗
        newUUID_bill = uuidv4();
        console.log("✅ สร้างบิลใหม่:", newUUID_bill);

        // บันทึกบิลใหม่
        await connection.execute(
          `INSERT INTO bill_flower (id_bill_flower, txt_id_order, user_customers_id, status, url_payment, total_payment, send_flowers_id) 
           VALUES (?, ?, ?, 1, ?, ?, ?)`,
          [
            newUUID_bill,
            id_txt_order,
            user_id,
            imageUrl,
            total_payment,
            send_uuid,
          ]
        );

        // 🔄 บันทึกสินค้าทั้งหมดใน `bill_detail_flower`
        for (const item of cart) {
          await connection.execute(
            `INSERT INTO bill_detail_flower (id_detail_flower, bill_id_flower, id_bflower, amount, price, txt_send_flower) 
             VALUES (uuid(), ?, ?, ?, ?, ?)`,
            [newUUID_bill, item.id_product, item.amount, item.price, txt_send]
          );
        }
      }

      res.json({ status: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ status: false, message: "Server error" });
    } finally {
      connection.release();
    }
  }
);

app.post(
  "/payment_insert_preorderbill",
  upload_payment.single("image"),
  authenticateToken,
  async (req, res) => {
    const connection = await getConnection();
    try {
      console.log(req.body);

      let user_id = req.body.user_id;

      let recieve = JSON.parse(req.body.recieve || "[]");
      console.log("Parsed recieve:", recieve);
      const { fname, lname, tel, street, txt_address, zip } = recieve[0] || {};

      let Address = JSON.parse(req.body.Address || "[]");
      console.log("Parsed Address:", Address);
      const { district, province, subdistrict } = Address[0] || {};

      // let send_txt = JSON.parse(req.body.send_txt || "[]");
      // console.log("Parsed send_txt:", send_txt);
      // const { txt_send } = send_txt[0] || {};

      let cart = JSON.parse(req.body.cart || "[]");
      console.log("Parsed cart:", cart);

      if (!cart.length) {
        return res
          .status(400)
          .json({ status: false, message: "Cart is empty" });
      }

      // อัปโหลดไฟล์ภาพการชำระเงิน
      const imageUrl = `/assets/payment/${req.file.filename}`;
      console.log("✅ File Uploaded:", imageUrl);

      // สร้างเลขออเดอร์
      const prefix = "ORD16735";
      const timestamp = Date.now();
      let id_txt_order = prefix + timestamp;

      // UUID สำหรับการส่งของ
      let send_uuid = uuidv4();

      // บันทึกที่อยู่การจัดส่ง
      await connection.execute(
        `INSERT INTO send_flowers (id_send_flowers, fname, lname, tel, txt_address, street, district, subdistrict, province, zip_code) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          send_uuid,
          fname,
          lname,
          tel,
          txt_address,
          street,
          district,
          subdistrict,
          province,
          zip,
        ]
      );

      // ตรวจสอบว่ามี `bill_flower` ที่ `status = 0` อยู่หรือไม่
      const [existingBills] = await connection.execute(
        `SELECT id_bill_flower FROM bill_flower WHERE user_customers_id = ? AND status = 0 LIMIT 1`,
        [user_id]
      );

      let newUUID_bill;
      let total_payment = cart.reduce(
        (sum, item) => sum + item.price * item.amount,
        0
      ); // คำนวณราคารวมทั้งหมด

      newUUID_bill = uuidv4();

      // บันทึกบิลใหม่
      await connection.execute(
        `INSERT INTO bill_flower (id_bill_flower, txt_id_order, user_customers_id, status, url_payment, total_payment, send_flowers_id) 
         VALUES (?, ?, ?, 1, ?, ?, ?)`,
        [
          newUUID_bill,
          id_txt_order,
          user_id,
          imageUrl,
          total_payment,
          send_uuid,
        ]
      );
      newUUID_bill_detail_bunch = uuidv4();
      for (const item of cart) {
        // 🔄 เพิ่มสินค้าใหม่ในบิลปัจจุบัน
        await connection.execute(
          `INSERT INTO detail_flowers (id_df, flower_id, paper_id, pm_id, acc_id) 
             VALUES ( ?, ?, ?, ?, ?)`,
          [
            newUUID_bill_detail_bunch,
            item.id_product,
            item.id_paper,
            item.id_pm,
            item.id_ribbon,
          ]
        );
        await connection.execute(
          `INSERT INTO bill_detail_flower (id_detail_flower, bill_id_flower, id_create_bflower, amount, price, txt_send_flower) 
             VALUES (uuid(), ?, ?, ?, ?, ?)`,
          [
            newUUID_bill,
            newUUID_bill_detail_bunch,
            item.amount,
            item.price,
            item.txt_send,
          ]
        );
      }
      res.json({ status: true });
    } catch (err) {
      console.error("Error occurred:", err.message);
      res.status(500).json({ status: false, message: "Server error" });
    } finally {
      connection.release();
    }
  }
);

app.post("/preorder_flower_data", async (req, res) => {
  const connection = await getConnection();
  try {
    // console.log(userId);

    const [row_data_paper] = await connection.execute(`
  SELECT  price_paper,id_paper as id,name_paper as name ,img_paper as image
  from paper where delete_up is null 
  and  status_paper = 1
  limit 5
`);
    const [row_data_accessories] = await connection.execute(`
  SELECT  price_acc,id_acc as id,name_acc as name ,img_acc as image
  from accessories where delete_at is null
  and id_acc != 0  and  status_acc = 1
  limit 5
`);
    const [row_data_Money] = await connection.execute(`
  SELECT  price_pm,id_pm as id,name_pm as name ,img_pm as image
  from paper_money where delete_at is null   and id_pm != 0
    and  status_paper_money = 1
  limit 5
`);
    const [row_data_flower] = await connection.execute(`
  SELECT  price_flower,id_flower as id,name ,url_image as image
  from flowers where delete_up is null 
  and  status_flowers = 1 and id_flower != 0
  limit 5
`);
    // if (row_flower.length === 0) {
    //   return res.status(404).json({ status: false, message: "ไม่พบข้อมูล" });
    // }

    res.json({
      status: true,
      data_paper: row_data_paper,
      data_accessories: row_data_accessories,
      data_Money: row_data_Money,
      data_flower: row_data_flower,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: false, message: "Server error" });
  } finally {
    connection.release(); // ปล่อย connection กลับไปที่ pool
  }
});
app.post("/check_cart", authenticateToken, async (req, res) => {
  const connection = await getConnection();
  try {
    const userId = req.body.userId; // ดึง user id จาก token

    // console.log(userId);
    const [user] = await connection.execute(
      `SELECT 
    bdf.id_detail_flower AS id,
    bunf.name_code AS name,
    bunf.price,
    bdf.txt_send_flower,
    bdf.amount AS quantity,
    MIN(ia.url_image) AS image
FROM 
    bill_flower AS bf
LEFT JOIN 
    bill_detail_flower AS bdf ON bf.id_bill_flower = bdf.bill_id_flower
LEFT JOIN 
    bunch_flowers AS bunf ON bdf.id_bflower = bunf.id_bflower
LEFT JOIN 
    image_all AS ia ON bunf.id_bflower = ia.id_bflower
WHERE 
    bf.delete_up IS NULL 
    AND bdf.delete_up IS NULL 
    AND bunf.delete_up IS NULL
    AND bf.user_customers_id = ?
    and bunf.status_flowers = 1
    and bf.status = 0 
    and ia.delete_at IS NULL
GROUP BY 
    bdf.id_detail_flower, bunf.name_code, bunf.price, bdf.amount;`,
      [userId]
    );

    // if (user.length === 0) {
    //   return res.status(404).json({ status: false, message: "User not found" });
    // }

    res.json({
      status: true,
      data: user,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: false, message: "Server error" });
  } finally {
    connection.release(); // ปล่อย connection กลับไปที่ pool
  }
});

app.post("/check_follow", authenticateToken, async (req, res) => {
  const connection = await getConnection();
  console.log("dsdsd");
  try {
    const userId = req.body.userId; // ดึง user id จาก token

    // console.log(userId);
    const [user] = await connection.execute(
      `SELECT 
    bdf.id_detail_flower AS id,
    bunf.name_code AS name,
    bdf.price,
    bf.status_send,
    bdf.txt_send_flower,
    bdf.amount AS quantity,
    MIN(ia.url_image) AS image,
    sf.fname,
    sf.lname,
    sf.txt_address,
    sf.street,
    sf.district,
    sf.subdistrict,
    sf.province,
    sf.zip_code,
    sf.code_send
FROM 
    bill_flower AS bf
LEFT JOIN 
    bill_detail_flower AS bdf ON bf.id_bill_flower = bdf.bill_id_flower
LEFT JOIN 
    bunch_flowers AS bunf ON bdf.id_bflower = bunf.id_bflower
LEFT JOIN 
    image_all AS ia ON bunf.id_bflower = ia.id_bflower
LEFT JOIN 
    send_flowers AS sf ON bf.send_flowers_id = sf.id_send_flowers  -- ✅ เพิ่มการเชื่อมกับข้อมูลการจัดส่ง
WHERE 
    bf.delete_up IS NULL 
    AND bdf.delete_up IS NULL 
    AND bunf.delete_up IS  NULL
    AND bf.user_customers_id = ?
    AND bf.status = 1
    AND ia.url_image IS NOT NULL
     AND ia.delete_at IS  NULL
      and bdf.id_create_bflower IS  NULL
GROUP BY 
    bdf.id_detail_flower, bunf.name_code, bunf.price, bdf.amount, 
    sf.fname, sf.lname, sf.txt_address, sf.street, sf.district, sf.subdistrict, sf.province, sf.zip_code;`,
      [userId]
    );

    // if (user.length === 0) {
    //   return res.status(404).json({ status: false, message: "User not found" });
    // }

    res.json({
      status: true,
      data: user,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: false, message: "Server error" });
  } finally {
    connection.release(); // ปล่อย connection กลับไปที่ pool
  }
});

app.post("/check_preorderfollow", authenticateToken, async (req, res) => {
  const connection = await getConnection();
  console.log("dsdsd");
  try {
    const userId = req.body.userId; // ดึง user id จาก token

    // console.log(userId);
    const [user] = await connection.execute(
      `SELECT 
    bdf.id_detail_flower AS id,
    bunf.name_code AS name,
    bdf.price,
    bf.status_send,
    bdf.txt_send_flower,
    bdf.amount AS quantity,
    sf.fname,
    sf.lname,
    sf.txt_address,
    sf.street,
    sf.district,
    sf.subdistrict,
    sf.province,
    sf.zip_code,
    sf.code_send,
    flowers.id_flower,
    flowers.name,
    flowers.url_image,
    acc.id_acc,
    acc.name_acc,
    acc.img_acc,
    pp.id_paper,
    pp.name_paper,
    pp.img_paper,
    pm.id_pm,
    pm.name_pm,
    pm.img_pm
FROM 
    bill_flower AS bf
LEFT JOIN 
    bill_detail_flower AS bdf ON bf.id_bill_flower = bdf.bill_id_flower
LEFT JOIN 
    bunch_flowers AS bunf ON bdf.id_bflower = bunf.id_bflower
LEFT JOIN 
	detail_flowers as df on bdf.id_create_bflower = df.id_df
LEFT JOIN
	flowers ON df.flower_id = flowers.id_flower
LEFT JOIN
	accessories as acc ON df.acc_id = acc.id_acc
LEFT JOIN
	paper as pp ON df.paper_id = pp.id_paper
LEFT JOIN 
	paper_money as pm ON df.pm_id = pm.id_pm
LEFT JOIN 
    send_flowers AS sf ON bf.send_flowers_id = sf.id_send_flowers  
WHERE 
    bf.delete_up IS NULL 
    AND bdf.delete_up IS NULL 
    AND bunf.delete_up IS  NULL
    AND bf.user_customers_id = ?
    AND bf.status = 1
    and bdf.id_create_bflower IS NOT NULL
GROUP BY 
    bdf.id_detail_flower, bunf.name_code, bunf.price, bdf.amount, 
    sf.fname, sf.lname, sf.txt_address, sf.street, sf.district, sf.subdistrict, sf.province, sf.zip_code;`,
      [userId]
    );

    // if (user.length === 0) {
    //   return res.status(404).json({ status: false, message: "User not found" });
    // }

    res.json({
      status: true,
      data: user,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: false, message: "Server error" });
  } finally {
    connection.release(); // ปล่อย connection กลับไปที่ pool
  }
});

app.post("/update_detail_cart", authenticateToken, async (req, res) => {
  const connection = await getConnection();
  try {
    // console.log("Request Body:", req.body);
    const bill_detail_id = req.body.id; // ดึง id สินค้าที่ต้องการลบจาก body
    const amount = req.body.amount;
    const txt_send_flower = req.body.txt_send_flower;
    console.log(req.body);
    if (!bill_detail_id) {
      return res
        .status(400)
        .json({ status: false, message: "Missing bill_detail_id" });
    }

    // console.log("Deleting item with ID:", bill_detail_id);

    const [deleteResult] = await connection.execute(
      `update  bill_detail_flower set 
      txt_send_flower = ? ,amount = ?
      WHERE id_detail_flower = ?`,
      [txt_send_flower, amount, bill_detail_id]
    );

    if (deleteResult.affectedRows === 0) {
      return res
        .status(404)
        .json({ status: false, message: "ไม่พบสินค้าในตะกร้า" });
    }

    res.json({
      status: true,
      message: "แก้ไขสินค้าในตะกร้าเรียบร้อยแล้ว",
    });
  } catch (err) {
    console.error("Error deleting cart item:", err);
    res.status(500).json({ status: false, message: "Server error" });
  } finally {
    connection.release(); // ปล่อย connection กลับไปที่ pool
  }
});

app.delete("/del_detail_cart", authenticateToken, async (req, res) => {
  const connection = await getConnection();
  try {
    // console.log("Request Body:", req.body);
    const bill_detail_id = req.body.bill_detail_id; // ดึง id สินค้าที่ต้องการลบจาก body
    if (!bill_detail_id) {
      return res
        .status(400)
        .json({ status: false, message: "Missing bill_detail_id" });
    }

    // console.log("Deleting item with ID:", bill_detail_id);

    const [deleteResult] = await connection.execute(
      `DELETE FROM bill_detail_flower WHERE id_detail_flower = ?`,
      [bill_detail_id]
    );

    if (deleteResult.affectedRows === 0) {
      return res
        .status(404)
        .json({ status: false, message: "ไม่พบสินค้าในตะกร้า" });
    }

    res.json({
      status: true,
      message: "ลบสินค้าออกจากตะกร้าเรียบร้อยแล้ว",
    });
  } catch (err) {
    console.error("Error deleting cart item:", err);
    res.status(500).json({ status: false, message: "Server error" });
  } finally {
    connection.release(); // ปล่อย connection กลับไปที่ pool
  }
});

app.put("/add_cart", authenticateToken, async (req, res) => {
  let connection;
  const { id_bflower, amount, user_id, price, txt_send } = req.body;
  console.log(req.body);
  const prefix = "ORD16735"; // ค่าคงที่
  const timestamp = Date.now(); // ได้ค่าเวลาปัจจุบันในหน่วยมิลลิวินาที

  let id_txt_order = prefix + timestamp;
  try {
    // ตรวจสอบค่าว่าง
    if (!id_bflower || !amount || !user_id) {
      return res
        .status(400)
        .json({ status: false, message: "ข้อมูลไม่ครบถ้วน" });
    }

    connection = await getConnection();

    // ตรวจสอบว่ามีบิลที่ยังไม่ชำระอยู่หรือไม่
    const [existingBill] = await connection.execute(
      `SELECT id_bill_flower FROM bill_flower 
       WHERE user_customers_id = ? AND status = 0`,
      [user_id]
    );

    let billId;

    if (existingBill.length > 0) {
      // ถ้ามีบิลที่ยังไม่ชำระ ให้ใช้บิลนั้น
      billId = existingBill[0].id_bill_flower;
    } else {
      // ถ้าไม่มีบิลที่ยังไม่ชำระ ให้สร้างบิลใหม่
      await connection.execute(
        `INSERT INTO bill_flower (id_bill_flower, txt_id_order,user_customers_id, status) 
         VALUES (uuid(),?, ?, 0)`,
        [id_txt_order, user_id]
      );

      // รับ ID ของบิลใหม่
      const [createdBill] = await connection.execute(
        `SELECT id_bill_flower FROM bill_flower 
         WHERE user_customers_id = ? AND status = 0 
         ORDER BY create_up DESC LIMIT 1`,
        [user_id]
      );

      billId = createdBill[0].id_bill_flower;
    }

    // ตรวจสอบว่ามีรายการสินค้านี้อยู่ในตะกร้าหรือไม่
    const [existingDetail] = await connection.execute(
      `SELECT amount FROM bill_detail_flower 
       WHERE bill_id_flower = ? AND id_bflower = ?`,
      [billId, id_bflower]
    );

    if (existingDetail.length > 0) {
      // ถ้ามีรายการสินค้า ให้เพิ่มจำนวนสินค้า
      const newAmount = existingDetail[0].amount + amount;
      await connection.execute(
        `UPDATE bill_detail_flower 
         SET amount = ? 
         WHERE bill_id_flower = ? AND id_bflower = ?`,
        [newAmount, billId, id_bflower]
      );
    } else {
      // ถ้าไม่มี ให้เพิ่มรายการใหม่
      await connection.execute(
        `INSERT INTO bill_detail_flower (id_detail_flower, bill_id_flower, id_bflower, amount, price,txt_send_flower) 
         VALUES (uuid(), ?, ?, ?, ?,?)`,
        [billId, id_bflower, amount, price, txt_send]
      );
    }

    res.json({
      status: true,
      message: "เพิ่มสินค้าในตะกร้าเรียบร้อย",
    });
  } catch (err) {
    console.error("Error during adding cart:", err);
    res.status(500).json({ status: false, message: "Server error" });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// Admin ----------------------

app.post("/dashboard_admin", authenticateToken, async (req, res) => {
  const connection = await getConnection();
  try {
    // console.log(userId);
    const [row] =
      await connection.execute(`SELECT bill_flower.id_bill_flower as id_bill,sum(bill_detail_flower.amount*bill_detail_flower.price) as total_bill,
send_flowers_id as txt_send , user_customers.fname, user_customers.lname
FROM bill_flower
left join bill_detail_flower on bill_flower.id_bill_flower = bill_detail_flower.bill_id_flower
left join user_customers on bill_flower.user_customers_id = user_customers.id_uc
where status = 1 and bill_flower.delete_up IS NULL
GROUP BY bill_flower.id_bill_flower

`);

    const [row_customizer_total] = await connection.execute(`SELECT 
  DATE_FORMAT(bill_flower.create_up, '%Y-%m') AS month, 
  SUM(bill_detail_flower.price * bill_detail_flower.amount) AS total_payment
FROM 
  bill_flower
LEFT JOIN 
  bill_detail_flower
    ON bill_flower.id_bill_flower = bill_detail_flower.bill_id_flower
WHERE 
  bill_flower.status_send >= 1 and bill_detail_flower.id_create_bflower is NOT null
  and bill_flower.delete_up is null and bill_detail_flower.delete_up is null
GROUP BY 
  month
ORDER BY 
  month ;
`);

    const [row_flower_total] = await connection.execute(`SELECT 
  DATE_FORMAT(bill_flower.create_up, '%Y-%m') AS month, 
  SUM(bill_detail_flower.price * bill_detail_flower.amount) AS total_payment
FROM 
  bill_flower
LEFT JOIN 
  bill_detail_flower
    ON bill_flower.id_bill_flower = bill_detail_flower.bill_id_flower

WHERE 
  bill_flower.status_send >= 1 and bill_detail_flower.id_bflower is NOT null
  and bill_flower.delete_up is null and bill_detail_flower.delete_up is null

GROUP BY 
  month
ORDER BY 
  month ;
`);

    const [row_date_total] = await connection.execute(`SELECT 
  DATE_FORMAT(bill_flower.create_up, '%Y-%m') AS month
FROM 
  bill_flower
WHERE 
  bill_flower.status_send >= 1 
  and bill_flower.delete_up is null
GROUP BY 
  month
ORDER BY 
  month ;
`);

    const [row_bflower_amount_total] =
      await connection.execute(`SELECT bunch_flowers.id_bflower,bunch_flowers.name_code, 
       COALESCE(SUM(bill_detail_flower.amount), 0) AS total_amount
FROM bunch_flowers
LEFT JOIN bill_detail_flower 
    ON bill_detail_flower.id_bflower = bunch_flowers.id_bflower
    AND bill_detail_flower.delete_up IS NULL 
    AND bill_detail_flower.id_bflower IS NOT NULL
WHERE bunch_flowers.name_code IS NOT NULL 
  AND bunch_flowers.delete_up IS NULL
GROUP BY id_bflower,bunch_flowers.name_code
order by total_amount
`);

    // const [row_money_total] = await connection.execute(`SELECT
    //   DATE_FORMAT(bill_flower.create_up, '%Y-%m') AS month,
    //   SUM(bill_detail_flower.price * bill_detail_flower.amount) AS total_payment
    // FROM
    //   bill_flower
    // LEFT JOIN
    //   bill_detail_flower
    //     ON bill_flower.id_bill_flower = bill_detail_flower.bill_id_flower
    // LEFT JOIN
    //   bunch_flowers
    //     ON bill_detail_flower.id_bflower = bunch_flowers.id_bflower
    // WHERE
    //   bill_flower.status_send >= 1 and bill_detail_flower.id_bflower is NOT null
    //   and bill_flower.delete_up is null and bill_detail_flower.delete_up is null
    //   and bunch_flowers.typef_id = 2
    // GROUP BY
    //   month
    // ORDER BY
    //   month ;
    // `);

    if (row.length === 0) {
      return res.status(404).json({ status: false, message: "ไม่พบข้อมูล" });
    }

    res.json({
      status: true,
      data: row,
      data_customizer_total: row_customizer_total,
      data_flower_total: row_flower_total,
      data_date_total: row_date_total,
      data_bflower_amount_total: row_bflower_amount_total,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: false, message: "Server error" });
  } finally {
    connection.release(); // ปล่อย connection กลับไปที่ pool
  }
});

//
//
//
//
//
//
//
//
// ---------------------------------------------------------------
//
//
//
//
//
//
//
//
// edit type chance style scalar
app.post("/type_data_admin", authenticateToken, async (req, res) => {
  const connection = await getConnection();
  try {
    // console.log(userId);
    const [row] =
      await connection.execute(`SELECT id_tf as id, name_type_flower as name, status_type as status FROM type_flower where delete_up IS NULL
`);

    const [row_chance] =
      await connection.execute(`SELECT id_chance as id, detail as name, status_chance as status FROM chance where delete_up IS NULL
`);

    const [row_style] =
      await connection.execute(`SELECT id_style as id, name, status_style as status FROM style where delete_up IS NULL
`);

    const [row_scalar] =
      await connection.execute(`SELECT id_scalar as id, name_scalar as name, status_scalar as status  FROM scalar where delete_up IS NULL
`);

    if (row.length === 0) {
      return res.status(404).json({ status: false, message: "ไม่พบข้อมูล" });
    }

    res.json({
      status: true,
      data: row,
      data_chance: row_chance,
      data_style: row_style,
      data_scalar: row_scalar,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: false, message: "Server error" });
  } finally {
    connection.release(); // ปล่อย connection กลับไปที่ pool
  }
});

app.post(
  "/update_status_type_data_admin",
  authenticateToken,
  async (req, res) => {
    const connection = await getConnection();
    try {
      // console.log(userId);
      let choose_exe = req.body.choose;
      let id = req.body.id;
      let new_Status = req.body.new_Status;
      // console.log(req.body.choose);
      if (choose_exe == 1) {
        const [row_update] = await connection.execute(
          `UPDATE type_flower SET status_type = ? WHERE id_tf = ?
`,
          [new_Status, id]
        );
        if (row_update.length === 0) {
          return res
            .status(404)
            .json({ status: false, message: "ไม่พบข้อมูล" });
        } else {
          res.json({
            status: true,
          });
        }
      } else if (choose_exe == 2) {
        const [row_update] = await connection.execute(
          `UPDATE chance SET status_chance = ? WHERE id_chance = ?
`,
          [new_Status, id]
        );
        if (row_update.length === 0) {
          return res
            .status(404)
            .json({ status: false, message: "ไม่พบข้อมูล" });
        } else {
          res.json({
            status: true,
          });
        }
      } else if (choose_exe == 3) {
        const [row_update] = await connection.execute(
          `UPDATE style SET status_style = ? WHERE id_style = ?
`,
          [new_Status, id]
        );
        if (row_update.length === 0) {
          return res
            .status(404)
            .json({ status: false, message: "ไม่พบข้อมูล" });
        } else {
          res.json({
            status: true,
          });
        }
      } else if (choose_exe == 4) {
        const [row_update] = await connection.execute(
          `UPDATE scalar SET status_scalar = ? WHERE id_scalar = ?
`,
          [new_Status, id]
        );
        if (row_update.length === 0) {
          return res
            .status(404)
            .json({ status: false, message: "ไม่พบข้อมูล" });
        } else {
          res.json({
            status: true,
          });
        }
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ status: false, message: "Server error" });
    } finally {
      connection.release(); // ปล่อย connection กลับไปที่ pool
    }
  }
);

app.post("/delete_type_data_admin", authenticateToken, async (req, res) => {
  const connection = await getConnection();
  try {
    // console.log(userId);
    let choose_exe = req.body.choose;
    let id = req.body.id;
    // console.log(req.body.choose);
    if (choose_exe == 1) {
      const [row_update] = await connection.execute(
        `UPDATE type_flower SET delete_up = NOW() WHERE id_tf = ?
`,
        [id]
      );
      if (row_update.length === 0) {
        return res.status(404).json({ status: false, message: "ไม่พบข้อมูล" });
      } else {
        res.json({
          status: true,
        });
      }
    } else if (choose_exe == 2) {
      const [row_update] = await connection.execute(
        `UPDATE chance SET delete_up = NOW() WHERE id_chance = ?
`,
        [id]
      );
      if (row_update.length === 0) {
        return res.status(404).json({ status: false, message: "ไม่พบข้อมูล" });
      } else {
        res.json({
          status: true,
        });
      }
    } else if (choose_exe == 3) {
      const [row_update] = await connection.execute(
        `UPDATE style SET delete_up = NOW() WHERE id_style = ?
`,
        [id]
      );
      if (row_update.length === 0) {
        return res.status(404).json({ status: false, message: "ไม่พบข้อมูล" });
      } else {
        res.json({
          status: true,
        });
      }
    } else if (choose_exe == 4) {
      const [row_update] = await connection.execute(
        `UPDATE scalar SET delete_up = NOW() WHERE id_scalar = ?
`,
        [id]
      );
      if (row_update.length === 0) {
        return res.status(404).json({ status: false, message: "ไม่พบข้อมูล" });
      } else {
        res.json({
          status: true,
        });
      }
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: false, message: "Server error" });
  } finally {
    connection.release(); // ปล่อย connection กลับไปที่ pool
  }
});

app.post("/update_type_data_admin", authenticateToken, async (req, res) => {
  const connection = await getConnection();
  try {
    // console.log(userId);
    console.log(req.body);
    let choose_exe = req.body.choose;
    let id = req.body.id;
    let name = req.body.name;

    if (choose_exe == 1) {
      const [row_update] = await connection.execute(
        `UPDATE type_flower SET name_type_flower = ? WHERE id_tf = ?
`,
        [name, id]
      );
      if (row_update.length === 0) {
        return res.status(404).json({ status: false, message: "ไม่พบข้อมูล" });
      } else {
        res.json({
          status: true,
        });
      }
    } else if (choose_exe == 2) {
      const [row_update] = await connection.execute(
        `UPDATE chance SET detail = ? WHERE id_chance = ?
`,
        [name, id]
      );
      if (row_update.length === 0) {
        return res.status(404).json({ status: false, message: "ไม่พบข้อมูล" });
      } else {
        res.json({
          status: true,
        });
      }
    } else if (choose_exe == 3) {
      const [row_update] = await connection.execute(
        `UPDATE style SET name = ? WHERE id_style = ?
`,
        [name, id]
      );
      if (row_update.length === 0) {
        return res.status(404).json({ status: false, message: "ไม่พบข้อมูล" });
      } else {
        res.json({
          status: true,
        });
      }
    } else if (choose_exe == 4) {
      const [row_update] = await connection.execute(
        `UPDATE scalar SET name_scalar = ? WHERE id_scalar = ?
`,
        [name, id]
      );
      if (row_update.length === 0) {
        return res.status(404).json({ status: false, message: "ไม่พบข้อมูล" });
      } else {
        res.json({
          status: true,
        });
      }
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: false, message: "Server error" });
  } finally {
    connection.release(); // ปล่อย connection กลับไปที่ pool
  }
});

app.post("/add_type_data_admin", authenticateToken, async (req, res) => {
  const connection = await getConnection();
  try {
    // console.log(userId);
    // console.log(req.body);
    let choose_exe = req.body.choose;
    let id = req.body.id;
    let name = req.body.name;

    if (choose_exe == 1) {
      const [row_update] = await connection.execute(
        `INSERT INTO type_flower ( name_type_flower ) VALUES (?) 
`,
        [name]
      );
      if (row_update.length === 0) {
        return res.status(404).json({ status: false, message: "ไม่พบข้อมูล" });
      } else {
        if (row_update.affectedRows === 0) {
          return res
            .status(404)
            .json({ status: false, message: "เพิ่มข้อมูลไม่สำเร็จ" });
        } else {
          res.json({
            status: true,
            id: row_update.insertId, // ✅ ส่ง id กลับ
            message: "เพิ่มข้อมูลสำเร็จ",
          });
        }
      }
    } else if (choose_exe == 2) {
      const [row_update] = await connection.execute(
        `INSERT INTO chance ( detail ) VALUES (?) 
`,
        [name]
      );
      if (row_update.length === 0) {
        return res.status(404).json({ status: false, message: "ไม่พบข้อมูล" });
      } else {
        if (row_update.affectedRows === 0) {
          return res
            .status(404)
            .json({ status: false, message: "เพิ่มข้อมูลไม่สำเร็จ" });
        } else {
          res.json({
            status: true,
            id: row_update.insertId, // ✅ ส่ง id กลับ
            message: "เพิ่มข้อมูลสำเร็จ",
          });
        }
      }
    } else if (choose_exe == 3) {
      const [row_update] = await connection.execute(
        `INSERT INTO style ( name ) VALUES (?) 
`,
        [name]
      );
      if (row_update.length === 0) {
        return res.status(404).json({ status: false, message: "ไม่พบข้อมูล" });
      } else {
        if (row_update.affectedRows === 0) {
          return res
            .status(404)
            .json({ status: false, message: "เพิ่มข้อมูลไม่สำเร็จ" });
        } else {
          res.json({
            status: true,
            id: row_update.insertId, // ✅ ส่ง id กลับ
            message: "เพิ่มข้อมูลสำเร็จ",
          });
        }
      }
    } else if (choose_exe == 4) {
      const [row_update] = await connection.execute(
        `INSERT INTO scalar(name_scalar) VALUES (?)
`,
        [name]
      );
      if (row_update.length === 0) {
        return res.status(404).json({ status: false, message: "ไม่พบข้อมูล" });
      } else {
        if (row_update.affectedRows === 0) {
          return res
            .status(404)
            .json({ status: false, message: "เพิ่มข้อมูลไม่สำเร็จ" });
        } else {
          res.json({
            status: true,
            id: row_update.insertId, // ✅ ส่ง id กลับ
            message: "เพิ่มข้อมูลสำเร็จ",
          });
        }
      }
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: false, message: "Server error" });
  } finally {
    connection.release(); // ปล่อย connection กลับไปที่ pool
  }
});
//
//
//
//
//
//
//
//
// ---------------------------------------------------------------
//
//
//
//
//
//
//
//

app.post("/flower_data_admin", authenticateToken, async (req, res) => {
  const connection = await getConnection();
  try {
    // console.log(userId);
    const [row_stock] = await connection.execute(`
      SELECT 
        COUNT(id_flower) AS total, -- ✅ นับสินค้าทั้งหมด
        SUM(CASE WHEN FLOOR(amount_flower / ratio_flower) > 3 THEN 1 ELSE 0 END) AS total_available,
        SUM(CASE WHEN FLOOR(amount_flower / ratio_flower) BETWEEN 1 AND 3 THEN 1 ELSE 0 END) AS total_almost,
        SUM(CASE WHEN FLOOR(amount_flower / ratio_flower) = 0 THEN 1 ELSE 0 END) AS total_sold_out
      FROM flowers 
      WHERE delete_up IS NULL and id_flower != 0;
    `);

    const [row_flower] =
      await connection.execute(`select id_flower,name,price_flower,color_id,status_flowers as status ,url_image as image,FLOOR(amount_flower/ratio_flower) as available, amount_flower as amount,ratio_flower as ratio,meaning 
        from flowers where delete_up IS NULL and  id_flower != 0
`);
    const [row_flower_color] =
      await connection.execute(`select id_color as id , name from colors where delete_up IS NULL
`);
    const [row_group_count] = await connection.execute(`SELECT 
    type_flower.name_type_flower AS name,
    COALESCE(COUNT(bunch_flowers.id_bflower), 0) AS data
FROM 
    type_flower
LEFT JOIN 
    bunch_flowers 
ON 
    type_flower.id_tf = bunch_flowers.typef_id
WHERE 
    type_flower.delete_up IS NULL 
    AND (bunch_flowers.delete_up IS NULL OR bunch_flowers.id_bflower IS NULL)
    and status_flowers = 1
GROUP BY 
    type_flower.id_tf, type_flower.name_type_flower;
`);
    if (row_flower.length === 0) {
      return res.status(404).json({ status: false, message: "ไม่พบข้อมูล" });
    }

    res.json({
      status: true,
      data: row_flower,
      data_group: row_group_count,
      data_stock: row_stock,
      data_flower_color: row_flower_color,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: false, message: "Server error" });
  } finally {
    connection.release(); // ปล่อย connection กลับไปที่ pool
  }
});

app.post("/paper_data_admin", authenticateToken, async (req, res) => {
  const connection = await getConnection();
  try {
    // console.log(userId);
    //     const [row_total] =
    //       await connection.execute(`select count(id_flower) as total from flowers where delete_up IS NULL
    // `);
    const [row_stock] = await connection.execute(`
  SELECT 
    COUNT(id_paper) AS total, -- ✅ นับสินค้าทั้งหมด
    SUM(CASE WHEN FLOOR(amount_paper / ratio_paper) > 3 THEN 1 ELSE 0 END) AS total_available,
    SUM(CASE WHEN FLOOR(amount_paper / ratio_paper) BETWEEN 1 AND 3 THEN 1 ELSE 0 END) AS total_almost,
    SUM(CASE WHEN FLOOR(amount_paper / ratio_paper) = 0 THEN 1 ELSE 0 END) AS total_sold_out
  FROM paper
  WHERE delete_up IS NULL and id_paper != 0;
`);

    const [row_flower] =
      await connection.execute(`select id_paper,price_paper,name_paper as name,status_paper as status ,
        img_paper as image,FLOOR(amount_paper/ratio_paper) as available,
         amount_paper as amount,ratio_paper as ratio from paper
          where delete_up IS NULL
`);

    const [row_group_count] = await connection.execute(`SELECT 
    type_flower.name_type_flower AS name,
    COALESCE(COUNT(bunch_flowers.id_bflower), 0) AS data
FROM 
    type_flower
LEFT JOIN 
    bunch_flowers 
ON 
    type_flower.id_tf = bunch_flowers.typef_id
WHERE 
    type_flower.delete_up IS NULL 
    AND (bunch_flowers.delete_up IS NULL OR bunch_flowers.id_bflower IS NULL)
    and status_flowers = 1
GROUP BY 
    type_flower.id_tf, type_flower.name_type_flower;
`);
    if (row_flower.length === 0) {
      return res.status(404).json({ status: false, message: "ไม่พบข้อมูล" });
    }

    res.json({
      status: true,
      data: row_flower,
      data_group: row_group_count,
      data_stock: row_stock,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: false, message: "Server error" });
  } finally {
    connection.release(); // ปล่อย connection กลับไปที่ pool
  }
});

app.post("/paperMoney_data_admin", authenticateToken, async (req, res) => {
  const connection = await getConnection();
  try {
    const [row_stock] = await connection.execute(`
      SELECT 
        COUNT(id_pm) AS total,
        SUM(CASE WHEN FLOOR(amount_pm / ratio_pm) > 3 THEN 1 ELSE 0 END) AS total_available,
        SUM(CASE WHEN FLOOR(amount_pm / ratio_pm) BETWEEN 1 AND 3 THEN 1 ELSE 0 END) AS total_almost,
        SUM(CASE WHEN FLOOR(amount_pm / ratio_pm) = 0 THEN 1 ELSE 0 END) AS total_sold_out
      FROM paper_money
      WHERE delete_at IS NULL and id_pm != 0;
    `);

    const [row_flower] = await connection.execute(`
      SELECT 
        id_pm, 
        name_pm AS name, 
        price_pm,
        status_paper_money AS status, 
        img_pm AS image, 
        FLOOR(amount_pm / ratio_pm) AS available, 
        amount_pm AS amount, 
        ratio_pm AS ratio 
      FROM paper_money  
      WHERE delete_at IS NULL and id_pm != 0;
    `);

    if (row_flower.length === 0) {
      return res.status(404).json({ status: false, message: "ไม่พบข้อมูล" });
    }

    res.json({
      status: true,
      data: row_flower,
      data_stock: row_stock,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: false, message: "Server error" });
  } finally {
    connection.release();
  }
});

app.post("/accessories_data_admin", authenticateToken, async (req, res) => {
  let connection;
  try {
    connection = await getConnection(); // ดึง connection

    // ใช้ Promise.all เพื่อให้ SQL Query ทำงานพร้อมกัน
    const [row_stock] = await connection.execute(`
      SELECT 
          COUNT(id_acc) AS total,
          SUM(amount_acc) AS total_available,
          SUM(CASE WHEN FLOOR(amount_acc) BETWEEN 1 AND 3 THEN 1 ELSE 0 END) AS total_almost,
          SUM(CASE WHEN FLOOR(amount_acc) = 0 THEN 1 ELSE 0 END) AS total_sold_out
        FROM accessories
        WHERE delete_at IS NULL  and id_acc != 0  ;
    `);

    const [row_flower] = await connection.execute(`
      SELECT 
        id_acc, 
        price_acc,
        name_acc AS name, 
        status_acc AS status, 
        img_acc AS image, 
        amount_acc AS amount
      FROM accessories  
      WHERE delete_at IS NULL and id_acc != 0;
    `);

    // ตรวจสอบว่ามีข้อมูลหรือไม่
    if (
      !Array.isArray(row_flower) ||
      row_flower.length === 0 ||
      row_flower[0].length === 0
    ) {
      return res.status(404).json({ status: false, message: "ไม่พบข้อมูล" });
    }

    // ส่งข้อมูลกลับไป
    res.json({
      status: true,
      data: row_flower,
      data_stock: row_stock,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: false, message: "Server error" });
  } finally {
    connection.release();
  }
});

app.post(
  "/update_status_stock_data_admin",
  authenticateToken,
  async (req, res) => {
    const connection = await getConnection();
    try {
      // console.log(userId);
      let choose_exe = req.body.choose;
      let id = req.body.id;
      let new_Status = req.body.new_Status;
      // console.log(req.body.choose);
      if (choose_exe == 1) {
        const [row_update] = await connection.execute(
          `UPDATE flowers SET status_flowers = ? WHERE id_flower = ?
`,
          [new_Status, id]
        );
        if (row_update.length === 0) {
          return res
            .status(404)
            .json({ status: false, message: "ไม่พบข้อมูล" });
        } else {
          res.json({
            status: true,
          });
        }
      } else if (choose_exe == 2) {
        const [row_update] = await connection.execute(
          `UPDATE paper SET status_paper = ? WHERE id_paper = ?
`,
          [new_Status, id]
        );
        if (row_update.length === 0) {
          return res
            .status(404)
            .json({ status: false, message: "ไม่พบข้อมูล" });
        } else {
          res.json({
            status: true,
          });
        }
      } else if (choose_exe == 3) {
        const [row_update] = await connection.execute(
          `UPDATE paper_money SET status_paper_money = ? WHERE id_pm = ?
`,
          [new_Status, id]
        );
        if (row_update.length === 0) {
          return res
            .status(404)
            .json({ status: false, message: "ไม่พบข้อมูล" });
        } else {
          res.json({
            status: true,
          });
        }
      } else if (choose_exe == 4) {
        const [row_update] = await connection.execute(
          `UPDATE accessories SET status_acc = ? WHERE id_acc = ?
`,
          [new_Status, id]
        );
        if (row_update.length === 0) {
          return res
            .status(404)
            .json({ status: false, message: "ไม่พบข้อมูล" });
        } else {
          res.json({
            status: true,
          });
        }
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ status: false, message: "Server error" });
    } finally {
      connection.release(); // ปล่อย connection กลับไปที่ pool
    }
  }
);

app.post(
  "/upload_img_stock_flower_admin",
  upload.single("image"),
  async (req, res) => {
    console.log("Upload directory path:", req.file);
    const connection = await getConnection();
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ status: false, message: "No file uploaded" });
      }

      const id = req.body.id;
      const choose_img = req.body.choose;
      console.log(id);
      console.log(choose_img);
      const imageUrl = `/assets/image_all/${req.file.filename}`; // เก็บพาธรูป
      console.log(imageUrl);
      // 📌 บันทึกข้อมูลลงฐานข้อมูล

      if (choose_img == 1) {
        const [result] = await connection.execute(
          `update flowers set url_image = ? where id_flower = ?`,
          [imageUrl, id]
        );
        connection.release();
        if (result.affectedRows === 0) {
          return res
            .status(404)
            .json({ status: false, message: "ไม่สามารถเพิ่มข้อมูล" });
        } else {
          res.json({
            status: true,
            message: "อัปโหลดสำเร็จ",
            imageUrl,
          });
        }
      } else if (choose_img == 2) {
        const [result] = await connection.execute(
          `update paper set img_paper = ? where id_paper = ?`,
          [imageUrl, id]
        );
        connection.release();
        if (result.affectedRows === 0) {
          return res
            .status(404)
            .json({ status: false, message: "ไม่สามารถเพิ่มข้อมูล" });
        } else {
          res.json({
            status: true,
            message: "อัปโหลดสำเร็จ",
            imageUrl,
          });
        }
      } else if (choose_img == 3) {
        const [result] = await connection.execute(
          `update paper_money set img_pm = ? where id_pm = ?`,
          [imageUrl, id]
        );
        connection.release();
        if (result.affectedRows === 0) {
          return res
            .status(404)
            .json({ status: false, message: "ไม่สามารถเพิ่มข้อมูล" });
        } else {
          res.json({
            status: true,
            message: "อัปโหลดสำเร็จ",
            imageUrl,
          });
        }
      } else if (choose_img == 4) {
        const [result] = await connection.execute(
          `update accessories set img_acc = ? where id_acc = ?`,
          [imageUrl, id]
        );
        connection.release();
        if (result.affectedRows === 0) {
          return res
            .status(404)
            .json({ status: false, message: "ไม่สามารถเพิ่มข้อมูล" });
        } else {
          res.json({
            status: true,
            message: "อัปโหลดสำเร็จ",
            imageUrl,
          });
        }
      }
    } catch (error) {
      console.error("Error uploading image:", error);
      res.status(500).json({ status: false, message: "Server error" });
    } finally {
      connection.release(); // ปล่อย connection กลับไปที่ pool
    }
  }
);

app.post("/update_flower", authenticateToken, async (req, res) => {
  const connection = await getConnection();
  try {
    const {
      id_flower = 0,
      name = "",
      color_id = 0,
      amount = 0,
      ratio = 0,
      meaning = "",
      price_flower = 0,
    } = req.body.flowerData || {};
    // const id_bflower = req.body.id_bflower;
    const id_choose = req.body.choose;

    // console.log(id_choose);

    const [updateResult] = await connection.execute(
      `UPDATE flowers 
       SET name = ? ,meaning = ? ,color_id =?,ratio_flower =? ,amount_flower =? , price_flower = ? 
       WHERE delete_up IS NULL AND id_flower = ?`,
      [name, meaning, color_id, ratio, amount, price_flower, id_flower]
    );
    // console.log(updateResult)
    connection.release();

    if (updateResult.affectedRows > 0) {
      res.json({ status: true, message: "อัปเดตข้อมูลสำเร็จ" });
    } else {
      res.json({
        status: false,
        message: "ไม่พบข้อมูลหรือไม่มีการเปลี่ยนแปลง",
      });
    }
  } catch (err) {
    console.error("Error updating data:", err);
    res.status(500).json({ status: false, message: "Server error" });
  } finally {
    connection.release(); // ปล่อย connection กลับไปที่ pool
  }
});
app.post(
  "/add_flower",
  upload.single("image"),
  authenticateToken,
  async (req, res) => {
    const selectedRow = JSON.parse(req.body.selectedRow); // แปลง JSON string กลับเป็นอ็อบเจ็กต์
    console.log(selectedRow); // แสดงข้อมูล selectedRow ที่ถูกส่งม
    const connection = await getConnection();
    try {
      const {
        id_flower = 0,
        name = "",
        color_id = 0,
        amount = 0,
        ratio = 0,
        meaning = "",
        price_flower = 0,
      } = selectedRow || {};
      // const id_bflower = req.body.id_bflower;
      console.log(name);
      const imageUrl = `/assets/image_all/${req.file.filename}`; // เก็บพาธรูป
      console.log(imageUrl);

      // console.log(id_choose);

      const [insertResult] = await connection.execute(
        `INSERT INTO flowers (name, meaning, color_id, ratio_flower, amount_flower, price_flower,url_image) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [name, meaning, color_id, ratio, amount, price_flower, imageUrl]
      );
      // console.log(updateResult)
      connection.release();

      if (insertResult.affectedRows > 0) {
        res.json({ status: true, message: "อัปเดตข้อมูลสำเร็จ" });
      } else {
        res.json({
          status: false,
          message: "ไม่พบข้อมูลหรือไม่มีการเปลี่ยนแปลง",
        });
      }
    } catch (err) {
      console.error("Error updating data:", err);
      res.status(500).json({ status: false, message: "Server error" });
    } finally {
      connection.release(); // ปล่อย connection กลับไปที่ pool
    }
  }
);

app.post("/update_paper", authenticateToken, async (req, res) => {
  const connection = await getConnection();
  try {
    const {
      id_paper = 0,
      name = "",
      amount = 0,
      ratio = 0,
      price_paper = 0,
    } = req.body.flowerData || {};
    // const id_bflower = req.body.id_bflower;
    // const id_choose = req.body.choose;

    // console.log(id_choose);

    const [updateResult] = await connection.execute(
      `UPDATE paper 
       SET name_paper = ?,ratio_paper =? ,amount_paper =? , price_paper =?
       WHERE delete_up IS NULL AND id_paper = ?`,
      [name, ratio, amount, price_paper, id_paper]
    );
    // console.log(updateResult)
    connection.release();

    if (updateResult.affectedRows > 0) {
      res.json({ status: true, message: "อัปเดตข้อมูลสำเร็จ" });
    } else {
      res.json({
        status: false,
        message: "ไม่พบข้อมูลหรือไม่มีการเปลี่ยนแปลง",
      });
    }
  } catch (err) {
    console.error("Error updating data:", err);
    res.status(500).json({ status: false, message: "Server error" });
  } finally {
    connection.release(); // ปล่อย connection กลับไปที่ pool
  }
});

app.post(
  "/add_paper",
  upload.single("image"),
  authenticateToken,
  async (req, res) => {
    const selectedRow = JSON.parse(req.body.selectedRow); // แปลง JSON string กลับเป็นอ็อบเจ็กต์
    console.log(selectedRow); // แสดงข้อมูล selectedRow ที่ถูกส่งม
    const connection = await getConnection();
    try {
      const {
        id_paper = 0,
        name = "",
        amount = 0,
        ratio = 0,
        price_paper = 0,
      } = selectedRow || {};
      // const id_bflower = req.body.id_bflower;
      console.log(name);
      const imageUrl = `/assets/image_all/${req.file.filename}`; // เก็บพาธรูป
      console.log(imageUrl);

      // console.log(id_choose);

      const [insertResult] = await connection.execute(
        `INSERT INTO paper (name_paper, ratio_paper, amount_paper, price_paper,img_paper)
       VALUES (?, ?, ?, ?, ?  )`,
        [name, ratio, amount, price_paper, imageUrl]
      );
      // console.log(updateResult)
      connection.release();

      if (insertResult.affectedRows > 0) {
        res.json({ status: true, message: "อัปเดตข้อมูลสำเร็จ" });
      } else {
        res.json({
          status: false,
          message: "ไม่พบข้อมูลหรือไม่มีการเปลี่ยนแปลง",
        });
      }
    } catch (err) {
      console.error("Error updating data:", err);
      res.status(500).json({ status: false, message: "Server error" });
    } finally {
      connection.release(); // ปล่อย connection กลับไปที่ pool
    }
  }
);

app.post("/update_papermoney", authenticateToken, async (req, res) => {
  const connection = await getConnection();
  try {
    const {
      id_pm = 0,
      name = "",
      amount = 0,
      ratio = 0,
      price_pm = 0,
    } = req.body.flowerData || {};
    // const id_bflower = req.body.id_bflower;
    // const id_choose = req.body.choose;

    // console.log(id_choose);

    const [updateResult] = await connection.execute(
      `UPDATE paper_money 
       SET 	name_pm = ?,ratio_pm =? ,amount_pm =? , price_pm = ?
       WHERE delete_at IS NULL AND id_pm= ?`,
      [name, ratio, amount, price_pm, id_pm]
    );
    // console.log(updateResult)
    connection.release();

    if (updateResult.affectedRows > 0) {
      res.json({ status: true, message: "อัปเดตข้อมูลสำเร็จ" });
    } else {
      res.json({
        status: false,
        message: "ไม่พบข้อมูลหรือไม่มีการเปลี่ยนแปลง",
      });
    }
  } catch (err) {
    console.error("Error updating data:", err);
    res.status(500).json({ status: false, message: "Server error" });
  } finally {
    connection.release(); // ปล่อย connection กลับไปที่ pool
  }
});

app.post(
  "/add_papermoney",
  upload.single("image"),
  authenticateToken,
  async (req, res) => {
    const selectedRow = JSON.parse(req.body.selectedRow); // แปลง JSON string กลับเป็นอ็อบเจ็กต์
    console.log(selectedRow); // แสดงข้อมูล selectedRow ที่ถูกส่งม
    const connection = await getConnection();
    try {
      const {
        id_pm = 0,
        name = "",
        amount = 0,
        ratio = 0,
        price_pm = 0,
      } = selectedRow || {};
      // const id_bflower = req.body.id_bflower;
      console.log(name);
      const imageUrl = `/assets/image_all/${req.file.filename}`; // เก็บพาธรูป
      console.log(imageUrl);

      // console.log(id_choose);

      const [insertResult] = await connection.execute(
        `INSERT INTO paper_money (name_pm, ratio_pm, amount_pm, price_pm, img_pm)
       VALUES (?, ?, ?, ?, ?)`,
        [name, ratio, amount, price_pm, imageUrl]
      );
      // console.log(updateResult)
      connection.release();

      if (insertResult.affectedRows > 0) {
        res.json({ status: true, message: "อัปเดตข้อมูลสำเร็จ" });
      } else {
        res.json({
          status: false,
          message: "ไม่พบข้อมูลหรือไม่มีการเปลี่ยนแปลง",
        });
      }
    } catch (err) {
      console.error("Error updating data:", err);
      res.status(500).json({ status: false, message: "Server error" });
    } finally {
      connection.release(); // ปล่อย connection กลับไปที่ pool
    }
  }
);

app.post("/update_accessories", authenticateToken, async (req, res) => {
  const connection = await getConnection();
  try {
    const {
      id_acc = 0,
      name = "",
      amount = 0,
      price_acc = 0,
    } = req.body.flowerData || {};
    // const id_bflower = req.body.id_bflower;
    // const id_choose = req.body.choose;

    // console.log(req.body.flowerData);

    const [updateResult] = await connection.execute(
      `UPDATE accessories 
       SET 	name_acc = ?,amount_acc =? , price_acc = ?
       WHERE delete_at IS NULL AND id_acc= ?`,
      [name, amount, price_acc, id_acc]
    );
    // console.log(updateResult)
    connection.release();

    if (updateResult.affectedRows > 0) {
      res.json({ status: true, message: "อัปเดตข้อมูลสำเร็จ" });
    } else {
      res.json({
        status: false,
        message: "ไม่พบข้อมูลหรือไม่มีการเปลี่ยนแปลง",
      });
    }
  } catch (err) {
    console.error("Error updating data:", err);
    res.status(500).json({ status: false, message: "Server error" });
  } finally {
    connection.release(); // ปล่อย connection กลับไปที่ pool
  }
});

app.post(
  "/add_accessories",
  upload.single("image"),
  authenticateToken,
  async (req, res) => {
    const selectedRow = JSON.parse(req.body.selectedRow); // แปลง JSON string กลับเป็นอ็อบเจ็กต์
    console.log(selectedRow); // แสดงข้อมูล selectedRow ที่ถูกส่งม
    const connection = await getConnection();
    try {
      const {
        id_acc = 0,
        name = "",
        amount = 0,
        price_acc = 0,
      } = selectedRow || {};
      // const id_bflower = req.body.id_bflower;
      console.log(name);
      const imageUrl = `/assets/image_all/${req.file.filename}`; // เก็บพาธรูป
      console.log(imageUrl);

      // console.log(id_choose);

      const [insertResult] = await connection.execute(
        `INSERT INTO accessories (name_acc, amount_acc, price_acc, img_acc)
         VALUES (?, ?, ?, ?)`,
        [name, amount, price_acc, imageUrl]
      );
      // console.log(updateResult)
      connection.release();

      if (insertResult.affectedRows > 0) {
        res.json({ status: true, message: "อัปเดตข้อมูลสำเร็จ" });
      } else {
        res.json({
          status: false,
          message: "ไม่พบข้อมูลหรือไม่มีการเปลี่ยนแปลง",
        });
      }
    } catch (err) {
      console.error("Error updating data:", err);
      res.status(500).json({ status: false, message: "Server error" });
    } finally {
      connection.release(); // ปล่อย connection กลับไปที่ pool
    }
  }
);

app.post("/del_flower_admin", authenticateToken, async (req, res) => {
  const connection = await getConnection();
  try {
    // console.log("Request Body:", req.body);
    const id_flower = req.body.id_flower; // ดึง id สินค้าที่ต้องการลบจาก body
    const choose = req.body.choose;
    if (!id_flower) {
      return res.status(400).json({ status: false, message: "Missing id" });
    }

    console.log("Deleting item with ID:", choose);

    if (choose == 1) {
      const [deleteResult] = await connection.execute(
        `UPDATE flowers SET delete_up = NOW() WHERE id_flower = ?`,
        [id_flower]
      );

      if (deleteResult.affectedRows === 0) {
        return res.status(404).json({ status: false, message: "ไม่พบสินค้า" });
      }
    } else if (choose == 2) {
      const [deleteResult] = await connection.execute(
        `UPDATE paper SET delete_up = NOW() WHERE id_paper = ?`,
        [id_flower]
      );

      if (deleteResult.affectedRows === 0) {
        return res.status(404).json({ status: false, message: "ไม่พบสินค้า" });
      }
    } else if (choose == 3) {
      const [deleteResult] = await connection.execute(
        `UPDATE paper_money SET delete_at = NOW() WHERE id_pm = ?`,
        [id_flower]
      );

      if (deleteResult.affectedRows === 0) {
        return res.status(404).json({ status: false, message: "ไม่พบสินค้า" });
      }
    } else if (choose == 4) {
      const [deleteResult] = await connection.execute(
        `UPDATE accessories SET delete_at = NOW() WHERE id_acc = ?`,
        [id_flower]
      );

      if (deleteResult.affectedRows === 0) {
        return res.status(404).json({ status: false, message: "ไม่พบสินค้า" });
      }
    }
    res.json({
      status: true,
      message: "ลบสินค้าออกเรียบร้อยแล้ว",
    });
  } catch (err) {
    console.error("Error deleting cart item:", err);
    res.status(500).json({ status: false, message: "Server error" });
  } finally {
    connection.release(); // ปล่อย connection กลับไปที่ pool
  }
});

//
//
//
//
//
//
//
//
//
//
//
//
//
//
//
//
//
//
//
app.post("/bunch_flower_admin", authenticateToken, async (req, res) => {
  const connection = await getConnection();
  try {
    // console.log(userId);
    const [row_stock] = await connection.execute(`
      SELECT 
        COUNT(bunch_flowers.id_bflower) AS total, -- ✅ นับช่อดอกไม้ทั้งหมด
        SUM(CASE WHEN FLOOR(amount_flower / ratio_flower) > 3 THEN 1 ELSE 0 END) AS total_available, -- ✅ สินค้าพร้อมขาย
        SUM(CASE WHEN FLOOR(amount_flower / ratio_flower) BETWEEN 1 AND 3 THEN 1 ELSE 0 END) AS total_almost, -- ✅ สินค้าใกล้หมด
        SUM(CASE WHEN FLOOR(amount_flower / ratio_flower) = 0 THEN 1 ELSE 0 END) AS total_sold_out -- ✅ สินค้าหมด
      FROM bunch_flowers
      LEFT JOIN flowers ON bunch_flowers.id_flower = flowers.id_flower
      WHERE bunch_flowers.delete_up IS NULL;
    `);

    const [row_flower] = await connection.execute(`
    SELECT 
    bunch_flowers.id_bflower as id,
    bunch_flowers.name_code as name,
    MIN(image_all.url_image) AS image, -- เลือก URL รูปแรก (ตามลำดับการจัดเก็บ)
    FLOOR(amount_flower / ratio_flower) AS available,
	  flowers.amount_flower as amount,
    bunch_flowers.id_flower ,
    bunch_flowers.status_flowers as status,
    price,style.name as type_name
FROM 
    bunch_flowers
LEFT JOIN 
    flowers ON bunch_flowers.id_flower = flowers.id_flower
LEFT JOIN 
    image_all ON bunch_flowers.id_bflower = image_all.id_bflower
LEFT JOIN 
    style ON bunch_flowers.id_style = style.id_style
WHERE 
    bunch_flowers.delete_up IS NULL and image_all.delete_at IS NULL 
GROUP BY 
    bunch_flowers.id_bflower, 
    bunch_flowers.name_code, 
    FLOOR(amount_flower / ratio_flower);
`);

    if (row_flower.length === 0) {
      return res.status(404).json({ status: false, message: "ไม่พบข้อมูล" });
    }

    res.json({
      status: true,
      data: row_flower,
      data_stock: row_stock,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: false, message: "Server error" });
  } finally {
    connection.release(); // ปล่อย connection กลับไปที่ pool
  }
});

app.post("/preorder_flower_admin", authenticateToken, async (req, res) => {
  const connection = await getConnection();
  try {
    // console.log(userId);
    const [row_data] = await connection.execute(`
      SELECT 
        COUNT(detail_flowers.id_df) AS total,
        COUNT(CASE WHEN status_send = 0 OR status_send = 1 THEN detail_flowers.id_df END) AS total_available,
        SUM(price * amount) AS total_price,
        COUNT(CASE WHEN status_send = 2 OR status_send = 3 THEN detail_flowers.id_df END) AS total_sold_out
      FROM bill_flower
      LEFT JOIN bill_detail_flower ON bill_flower.id_bill_flower = bill_detail_flower.bill_id_flower
      LEFT JOIN detail_flowers ON bill_detail_flower.id_create_bflower = detail_flowers.id_df
      WHERE bill_detail_flower.id_create_bflower IS NOT NULL 
        AND bill_flower.delete_up IS NULL 
        AND detail_flowers.delete_up IS NULL
        and status_send != 4

    `);

    const [row_flower] = await connection.execute(`
    SELECT 
    detail_flowers.create_up as create_update ,
    bill_flower.id_bill_flower as id ,
    bill_flower.status_send as send_state,
    id_detail_flower,
    flowers.name as flower_name,
    paper_money.name_pm as name_paper_money,
    accessories.name_acc as name_access,
    paper.name_paper,
    txt_id_order,
    price,amount,
    txt_send_flower,
    send_flowers_id  as txt_send,
    detail_flowers.acc_id,
    detail_flowers.paper_id,
    detail_flowers.pm_id,
    detail_flowers.flower_id,
    id_df,
    bill_id_flower,
    code_send,
    id_send_flowers,
    url_payment,total_payment,comment,
    fname,lname,nname,tel,date_send,txt_address,street,district,subdistrict,province,zip_code
FROM 
    detail_flowers
LEFT JOIN 
    bill_detail_flower ON detail_flowers.id_df = bill_detail_flower.id_create_bflower
LEFT JOIN 
    bill_flower ON bill_detail_flower.bill_id_flower = bill_flower.id_bill_flower
LEFT JOIN
	flowers ON detail_flowers.flower_id = flowers.id_flower
LEFT JOIN
	paper_money ON detail_flowers.pm_id = paper_money.id_pm
LEFT JOIN
	accessories ON detail_flowers.acc_id = accessories.id_acc
LEFT JOIN
	paper ON detail_flowers.paper_id = paper.id_paper
LEFT JOIN send_flowers 
ON   bill_flower.send_flowers_id =  send_flowers.id_send_flowers
WHERE 
    bill_detail_flower.delete_up IS  NULL 
    AND bill_flower.delete_up IS NULL 
    AND detail_flowers.delete_up IS NULL
    and status = 1 
`);

    const [row_data_paper] = await connection.execute(`
  SELECT  id_paper as id,name_paper as name ,img_paper as image
  from paper where delete_up is null
`);
    const [row_data_accessories] = await connection.execute(`
  SELECT  id_acc as id,name_acc as name ,img_acc as image
  from accessories where delete_at is null
`);
    const [row_data_Money] = await connection.execute(`
  SELECT  id_pm as id,name_pm as name ,img_pm as image
  from paper_money where delete_at is null
`);
    const [row_data_flower] = await connection.execute(`
  SELECT  id_flower as id,name ,url_image as image
  from flowers where delete_up is null
`);
    // if (row_flower.length === 0) {
    //   return res.status(404).json({ status: false, message: "ไม่พบข้อมูล" });
    // }

    res.json({
      status: true,
      data: row_flower,
      data_total: row_data,
      data_paper: row_data_paper,
      data_accessories: row_data_accessories,
      data_Money: row_data_Money,
      data_flower: row_data_flower,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: false, message: "Server error" });
  } finally {
    connection.release(); // ปล่อย connection กลับไปที่ pool
  }
});

app.post("/orderBill_flower_admin", authenticateToken, async (req, res) => {
  const connection = await getConnection();
  try {
    // console.log(userId);
    const [row_data] = await connection.execute(`
SELECT 
    COUNT(DISTINCT bill_flower.id_bill_flower) AS total, 
    COUNT(DISTINCT CASE WHEN status_send = 0 OR status_send = 1 THEN bill_flower.id_bill_flower END) AS total_available, 
    SUM(price * amount) AS total_price, 
    COUNT(DISTINCT CASE WHEN status_send = 2 OR status_send = 3 THEN bill_flower.id_bill_flower END) AS total_sold_out 
FROM bill_flower
LEFT JOIN bill_detail_flower ON bill_flower.id_bill_flower = bill_detail_flower.bill_id_flower
WHERE
bill_detail_flower.id_bflower IS NOT NULL and
bill_flower.delete_up IS NULL 
  AND bill_flower.status = 1 and bill_detail_flower.id_bflower IS NOT NULL
 and status_send != 4

    `);

    const [row_flower] = await connection.execute(`
SELECT bill_flower.id_bill_flower as id,status_send as send_state,sum(price* amount) as total,send_flowers.code_send, id_send_flowers
,sum(price * amount) as price,  sum(amount) as amount,fname,lname,nname,tel,date_send,txt_address,
street,district,subdistrict,province,zip_code, 
bill_flower.create_up,txt_id_order,url_payment,total_payment,comment
FROM bill_flower
LEFT join bill_detail_flower ON bill_flower.id_bill_flower = bill_detail_flower.bill_id_flower
LEFT join send_flowers ON bill_flower.send_flowers_id = send_flowers.id_send_flowers
WHERE bill_flower.status = 1 AND bill_detail_flower.id_bflower IS NOT NULL and
bill_flower.delete_up is null
GROUP BY id_bill_flower 
`);

    const [row_data_paper] = await connection.execute(`
  SELECT  id_paper as id,name_paper as name ,img_paper as image
  from paper where delete_up is null
`);
    const [row_data_accessories] = await connection.execute(`
  SELECT  id_acc as id,name_acc as name ,img_acc as image
  from accessories where delete_at is null
`);
    const [row_data_Money] = await connection.execute(`
  SELECT  id_pm as id,name_pm as name ,img_pm as image
  from paper_money where delete_at is null
`);
    const [row_data_flower] = await connection.execute(`
  SELECT  id_flower as id,name ,url_image as image
  from flowers where delete_up is null
`);
    // if (row_flower.length === 0) {
    //   return res.status(404).json({ status: false, message: "ไม่พบข้อมูล" });
    // }

    res.json({
      status: true,
      data: row_flower,
      data_total: row_data,
      data_paper: row_data_paper,
      data_accessories: row_data_accessories,
      data_Money: row_data_Money,
      data_flower: row_data_flower,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: false, message: "Server error" });
  } finally {
    connection.release(); // ปล่อย connection กลับไปที่ pool
  }
});
app.post(
  "/orderBill_detail_flower_admin",
  authenticateToken,
  async (req, res) => {
    const connection = await getConnection();
    try {
      // console.log(userId);
      const bill_id_flower = req.body.bill_id_flower;
      //  console.log(req.body)
      const [row_flower] = await connection.execute(
        `
SELECT 
    bill_flower.id_bill_flower, 
    bunch_flowers.name_code, 
    bill_detail_flower.id_detail_flower as id,
    txt_send_flower,
    bill_detail_flower.id_bflower,
    MIN(img.url_image) AS url_image ,bill_detail_flower.price,amount,
    paper.name_paper,paper_money.name_pm,flowers.name,accessories.name_acc
FROM bill_detail_flower 
LEFT JOIN bunch_flowers 
    ON bill_detail_flower.id_bflower = bunch_flowers.id_bflower
LEFT JOIN image_all AS img 
    ON bunch_flowers.id_bflower = img.id_bflower 
LEFT JOIN bill_flower 
    ON bill_detail_flower.bill_id_flower = bill_flower.id_bill_flower
LEFT JOIN paper
    ON bunch_flowers.paper_id = paper.id_paper 
LEFT JOIN paper_money 
    ON bunch_flowers.paper_m_id = paper_money.id_pm
LEFT JOIN flowers
    ON bunch_flowers.id_flower = flowers.id_flower
LEFT JOIN accessories
    ON bunch_flowers.acc_id = accessories.id_acc
WHERE 
    bill_detail_flower.id_bflower IS NOT NULL and
    bill_detail_flower.delete_up is null 
    AND img.delete_at IS NULL and bill_detail_flower.bill_id_flower = ?
GROUP BY 
    bill_flower.id_bill_flower, bunch_flowers.name_code 
ORDER BY 
    bill_flower.id_bill_flower 

`,
        [bill_id_flower]
      );

      const [row_bflower_all] = await connection.execute(`
SELECT bunch_flowers.id_bflower,bunch_flowers.name_code,MIN(img.url_image) AS url_image  ,price,
    paper.name_paper,paper_money.name_pm,flowers.name,accessories.name_acc
FROM bunch_flowers
LEFT JOIN image_all img ON bunch_flowers.id_bflower = img.id_bflower
LEFT JOIN paper
    ON bunch_flowers.paper_id = paper.id_paper 
LEFT JOIN paper_money 
    ON bunch_flowers.paper_m_id = paper_money.id_pm
LEFT JOIN flowers
    ON bunch_flowers.id_flower = flowers.id_flower
LEFT JOIN accessories
    ON bunch_flowers.acc_id = accessories.id_acc
WHERE bunch_flowers.id_bflower is not null and bunch_flowers.delete_up is null 
and bunch_flowers.status_flowers = 1  and img.delete_at IS NULL
GROUP BY bunch_flowers.id_bflower, bunch_flowers.name_code;`);

      res.json({
        status: true,
        data: row_flower,
        bflower_all: row_bflower_all,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ status: false, message: "Server error" });
    } finally {
      connection.release(); // ปล่อย connection กลับไปที่ pool
    }
  }
);

app.post("/update_bill", authenticateToken, async (req, res) => {
  const connection = await getConnection();
  try {
    const {
      id_detail_flower = "",
      acc_id = "",
      paper_id = "",
      pm_id = "",
      flower_id = "",
      id_df = "",
      price = 0,
      id = "",
      send_state = 0,
      txt_send_flower = "",
      id_send_flowers = "",
      code_send = "",
    } = req.body.flowerData || {};
    // const id_bflower = req.body.id_bflower;

    // console.log(req.body);

    const [updateBilldetailResult] = await connection.execute(
      `UPDATE bill_detail_flower 
       SET price = ?,txt_send_flower = ?
       WHERE delete_up IS NULL AND id_detail_flower = ?`,
      [price, txt_send_flower, id_detail_flower]
    );
    const [updateBill_detail_createResult] = await connection.execute(
      `UPDATE detail_flowers 
       SET acc_id = ?,paper_id = ? ,pm_id =? ,flower_id=?
       WHERE delete_up IS NULL AND id_df = ?`,
      [acc_id, paper_id, pm_id, flower_id, id_df]
    );
    const [updateBillResult] = await connection.execute(
      `UPDATE bill_flower 
       SET status_send = ?
       WHERE delete_up IS NULL AND id_bill_flower = ?`,
      [send_state, id]
    );
    const [updateBillSendResult] = await connection.execute(
      `UPDATE send_flowers 
       SET code_send = ?
       WHERE delete_up IS NULL AND id_send_flowers = ?`,
      [code_send, id_send_flowers]
    );
    // console.log(updateResult)
    connection.release();

    if (updateBillResult.affectedRows > 0) {
      res.json({ status: true, message: "อัปเดตข้อมูลสำเร็จ" });
    } else {
      res.json({
        status: false,
        message: "ไม่พบข้อมูลหรือไม่มีการเปลี่ยนแปลง",
      });
    }
  } catch (err) {
    console.error("Error updating data:", err);
    res.status(500).json({ status: false, message: "Server error" });
  } finally {
    connection.release(); // ปล่อย connection กลับไปที่ pool
  }
});

app.post("/update_sendBill", authenticateToken, async (req, res) => {
  const connection = await getConnection();
  try {
    const {
      id_send_flowers = "",
      code_send = "",
      fname = "",
      lname = "",
      nname = "",
      date_send = "",
      txt_address = "",
      tel = "",
      street = 0,
      district = "",
      subdistrict = "",
      province = "",
      zip_code = "",
    } = req.body.flowerData || {};
    // const id_bflower = req.body.id_bflower;

    // console.log(req.body);
    const [updateBillSendResult] = await connection.execute(
      `UPDATE send_flowers 
       SET code_send = ?, tel=?,
       fname = ? ,lname = ?, nname =?,
        date_send = STR_TO_DATE(?, '%Y-%m-%dT%H:%i:%s.%fZ'),txt_address = ?,street = ?,
       district = ? , subdistrict = ? ,
       province = ?, zip_code = ? 
       WHERE delete_up IS NULL AND id_send_flowers = ?`,
      [
        code_send,
        tel,
        fname,
        lname,
        nname,
        date_send,
        txt_address,
        street,
        district,
        subdistrict,
        province,
        zip_code,
        id_send_flowers,
      ]
    );
    // console.log(updateResult)
    connection.release();

    if (updateBillSendResult.affectedRows > 0) {
      res.json({ status: true, message: "อัปเดตข้อมูลสำเร็จ" });
    } else {
      res.json({
        status: false,
        message: "ไม่พบข้อมูลหรือไม่มีการเปลี่ยนแปลง",
      });
    }
  } catch (err) {
    console.error("Error updating data:", err);
    res.status(500).json({ status: false, message: "Server error" });
  } finally {
    connection.release(); // ปล่อย connection กลับไปที่ pool
  }
});
app.post("/update_billPayment", authenticateToken, async (req, res) => {
  const connection = await getConnection();
  try {
    const {
      id = "",
      total_payment = 0,
      send_state = 0,
      comment = "",
    } = req.body.flowerData || {};
    // const id_bflower = req.body.id_bflower;

    // console.log("dsds",req.body);

    const [updateBilldetailResult] = await connection.execute(
      `UPDATE bill_flower 
       SET total_payment = ?,status_send = ?,comment = ?
       WHERE delete_up IS NULL AND id_bill_flower  = ?`,
      [total_payment, send_state, comment, id]
    );
    // console.log(updateResult)
    connection.release();

    if (updateBilldetailResult.affectedRows > 0) {
      res.json({ status: true, message: "อัปเดตข้อมูลสำเร็จ" });
    } else {
      res.json({
        status: false,
        message: "ไม่พบข้อมูลหรือไม่มีการเปลี่ยนแปลง",
      });
    }
  } catch (err) {
    console.error("Error updating data:", err);
    res.status(500).json({ status: false, message: "Server error" });
  } finally {
    connection.release(); // ปล่อย connection กลับไปที่ pool
  }
});

app.post("/update_billdetail", authenticateToken, async (req, res) => {
  const connection = await getConnection();
  try {
    const {
      id = "",
      price = 0,
      amount = 0,
      id_bflower = "",
      txt_send_flower = "",
    } = req.body.flowerData || {};
    // const id_bflower = req.body.id_bflower;

    console.log(req.body);

    const [updateBilldetailResult] = await connection.execute(
      `UPDATE bill_detail_flower 
       SET price = ?,txt_send_flower = ?,amount = ?,id_bflower = ?
       WHERE delete_up IS NULL AND id_detail_flower = ?`,
      [price, txt_send_flower, amount, id_bflower, id]
    );
    // console.log(updateResult)
    connection.release();

    if (updateBilldetailResult.affectedRows > 0) {
      res.json({ status: true, message: "อัปเดตข้อมูลสำเร็จ" });
    } else {
      res.json({
        status: false,
        message: "ไม่พบข้อมูลหรือไม่มีการเปลี่ยนแปลง",
      });
    }
  } catch (err) {
    console.error("Error updating data:", err);
    res.status(500).json({ status: false, message: "Server error" });
  } finally {
    connection.release(); // ปล่อย connection กลับไปที่ pool
  }
});
app.post("/del_Preorder_bflower_admin", authenticateToken, async (req, res) => {
  const connection = await getConnection();
  try {
    // console.log("Request Body:", req.body);
    const id_bill_preOrder_flower = req.body.id_bill_preOrder_flower; // ดึง id สินค้าที่ต้องการลบจาก body
    console.log(req.body);
    if (!id_bill_preOrder_flower) {
      return res.status(400).json({ status: false, message: "Missing id" });
    }

    // console.log("Deleting item with ID:", id_bill_preOrder_flower);

    const [deleteResult] = await connection.execute(
      `UPDATE bill_flower SET delete_up = NOW() WHERE id_bill_flower = ?`,
      [id_bill_preOrder_flower]
    );

    const [deleteResult2] = await connection.execute(
      `UPDATE bill_detail_flower
SET delete_up = NOW()
WHERE bill_id_flower = ?`,
      [id_bill_preOrder_flower]
    );
    if (deleteResult.affectedRows === 0) {
      return res.status(404).json({ status: false, message: "ไม่พบสินค้า" });
    }

    res.json({
      status: true,
      message: "ลบสินค้าออกเรียบร้อยแล้ว",
    });
  } catch (err) {
    console.error("Error deleting cart item:", err);
    res.status(500).json({ status: false, message: "Server error" });
  } finally {
    connection.release(); // ปล่อย connection กลับไปที่ pool
  }
});

app.post(
  "/del_billdetail_bflower_admin",
  authenticateToken,
  async (req, res) => {
    const connection = await getConnection();
    try {
      // console.log("Request Body:", req.body);
      const id_bill_detail_flower = req.body.id_bill_detail_flower; // ดึง id สินค้าที่ต้องการลบจาก body
      console.log(req.body);
      if (!id_bill_detail_flower) {
        return res.status(400).json({ status: false, message: "Missing id" });
      }

      const [deleteResult2] = await connection.execute(
        `UPDATE bill_detail_flower
SET delete_up = NOW()
WHERE id_detail_flower = ?`,
        [id_bill_detail_flower]
      );
      if (deleteResult2.affectedRows === 0) {
        return res.status(404).json({ status: false, message: "ไม่พบสินค้า" });
      }

      res.json({
        status: true,
        message: "ลบสินค้าออกเรียบร้อยแล้ว",
      });
    } catch (err) {
      console.error("Error deleting cart item:", err);
      res.status(500).json({ status: false, message: "Server error" });
    } finally {
      connection.release(); // ปล่อย connection กลับไปที่ pool
    }
  }
);

app.post("/del_bflower_admin", authenticateToken, async (req, res) => {
  const connection = await getConnection();
  try {
    // console.log("Request Body:", req.body);
    const id_Bunch_flower = req.body.id_Bunch_flower; // ดึง id สินค้าที่ต้องการลบจาก body
    console.log(id_Bunch_flower);
    if (!id_Bunch_flower) {
      return res.status(400).json({ status: false, message: "Missing id" });
    }

    // console.log("Deleting item with ID:", id_Bunch_flower);

    const [deleteResult] = await connection.execute(
      `UPDATE bunch_flowers SET delete_up = NOW() WHERE id_bflower = ?`,
      [id_Bunch_flower]
    );

    if (deleteResult.affectedRows === 0) {
      return res.status(404).json({ status: false, message: "ไม่พบสินค้า" });
    }

    res.json({
      status: true,
      message: "ลบสินค้าออกเรียบร้อยแล้ว",
    });
  } catch (err) {
    console.error("Error deleting cart item:", err);
    res.status(500).json({ status: false, message: "Server error" });
  } finally {
    connection.release(); // ปล่อย connection กลับไปที่ pool
  }
});

app.post(
  "/update_status_bflower_admin",
  authenticateToken,
  async (req, res) => {
    const connection = await getConnection();
    try {
      // console.log("Request Body:", req.body);
      const id_b_flower = req.body.id_b_flower; // ดึง id
      //  สินค้าที่ต้องการลบจาก body
      const new_Status = req.body.new_Status;
      console.log(id_b_flower);
      if (!id_b_flower) {
        return res.status(400).json({ status: false, message: "Missing id" });
      }

      // console.log("Deleting item with ID:", id_b_flower);

      const [deleteResult] = await connection.execute(
        `UPDATE bunch_flowers SET status_flowers = ? WHERE id_bflower = ?`,
        [new_Status, id_b_flower]
      );

      if (deleteResult.affectedRows === 0) {
        return res.status(404).json({ status: false, message: "ไม่พบสินค้า" });
      }

      res.json({
        status: true,
        message: "ลบสินค้าออกเรียบร้อยแล้ว",
      });
    } catch (err) {
      console.error("Error deleting cart item:", err);
      res.status(500).json({ status: false, message: "Server error" });
    } finally {
      connection.release(); // ปล่อย connection กลับไปที่ pool
    }
  }
);
// add bflower
app.post("/get_data_add_BFlower_admin", authenticateToken, async (req, res) => {
  const connection = await getConnection();
  try {
    const [row_flower_all] = await connection.execute(`SELECT 
      id_flower as id_f,  name ,url_image
     FROM flowers
     WHERE flowers.delete_up IS NULL 
     ;
     `);
    const [row_type_all] = await connection.execute(`SELECT 
      id_tf as id_tf,  name_type_flower as name 
     FROM type_flower
     WHERE type_flower.delete_up IS NULL 
     ;
     `);
    const [row_style_all] = await connection.execute(`SELECT 
      id_style ,   name 
     FROM style
     WHERE style.delete_up	IS NULL 
     ;
     `);

    const [row_scalar_all] = await connection.execute(`SELECT 
      id_scalar as id_sc, name_scalar as   name 
     FROM scalar
     WHERE scalar.delete_up	IS NULL 
     ;
     `);

    const [row_chance_all] = await connection.execute(`SELECT 
      id_chance as id_ch, detail as   name 
     FROM chance
     WHERE chance.delete_up	IS NULL 
     ;
     `);

    const [row_paper] = await connection.execute(
      `SELECT 
      id_paper as id_p,  name_paper as name	, img_paper
     FROM paper
     WHERE paper.delete_up IS NULL 
     ;
     `
    );

    const [row_paper_moey] = await connection.execute(
      `SELECT 
      id_pm,  name_pm	as name ,img_pm
     FROM paper_money
     WHERE paper_money.delete_at IS NULL 
     ;
     `
    );

    const [row_acc] = await connection.execute(
      `SELECT 
      id_acc,  name_acc	 as name ,img_acc
     FROM accessories
     WHERE accessories.delete_at IS NULL 
     ;
     `
    );

    res.json({
      status: true,
      data_flower: row_flower_all,
      data_type_all: row_type_all,
      data_style_all: row_style_all,
      data_scalar_all: row_scalar_all,
      data_chance_all: row_chance_all,
      data_paper: row_paper,
      data_paper_money: row_paper_moey,
      data_accessories: row_acc,
    });
  } catch (err) {
    console.error("Error deleting cart item:", err);
    res.status(500).json({ status: false, message: "Server error" });
  } finally {
    connection.release(); // ปล่อย connection กลับไปที่ pool
  }
});

app.post("/create_BFlower_admin", authenticateToken, async (req, res) => {
  const {
    price = 0,
    name = "",
    typef_id = 0,
    scalar_id = 0,
    id_style = 0,
    id_flower = 0,
    chance_id = 0,
    description = "",
    paper_id = 0,
    paper_m_id = 0,
    acc_id = 0,
  } = req.body.bflowerData || {};
  const id_bflower = uuidv4();
  // console.log(req.body)
  const connection = await getConnection();
  try {
    const [insertResult] = await connection.execute(
      `INSERT INTO bunch_flowers 
        (id_bflower, price, name_code, typef_id, scalar_id, 
        id_style, id_flower, chance_id, description, paper_id, 
        paper_m_id, acc_id,status_flowers) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,1)`,
      [
        id_bflower,
        parseFloat(price),
        name,
        typef_id,
        scalar_id,
        id_style,
        id_flower,
        chance_id,
        description,
        paper_id,
        paper_m_id,
        acc_id,
      ]
    );

    // ✅ ตรวจสอบว่าการเพิ่มข้อมูลสำเร็จหรือไม่
    if (insertResult.affectedRows > 0) {
      // console.log(insertResult)
      res.json({
        status: true,
        message: "เพิ่มข้อมูลช่อดอกไม้สำเร็จ",
        id_bflower: id_bflower, // ส่งค่า ID กลับไปด้วย
      });
    } else {
      res.status(500).json({
        status: false,
        message: "ไม่สามารถเพิ่มข้อมูลได้",
      });
    }
  } catch (error) {
    console.error("Error inserting data:", error);
    res.status(500).json({
      status: false,
      message: "Server error",
    });
  } finally {
    connection.release(); // ปล่อย connection กลับไปที่ pool
  }
});

// edit BFlower
app.post("/get_data_BFlower_admin", authenticateToken, async (req, res) => {
  const id_bflower = req.body.id_bf;
  const connection = await getConnection();
  try {
    const [data_bflower] = await connection.execute(
      `select price,name_code as name,typef_id,scalar_id,
      id_style,id_flower,chance_id,description,paper_id,
      paper_m_id,acc_id from bunch_flowers WHERE delete_up IS NULL and id_bflower = ? `,
      [id_bflower]
    );

    const [row_flower_all] = await connection.execute(`SELECT 
      id_flower as id_f,  name ,url_image
     FROM flowers
     WHERE flowers.delete_up IS NULL 
     ;
     `);
    const [row_type_all] = await connection.execute(`SELECT 
      id_tf as id_tf,  name_type_flower as name 
     FROM type_flower
     WHERE type_flower.delete_up IS NULL 
     ;
     `);
    const [row_style_all] = await connection.execute(`SELECT 
      id_style ,   name 
     FROM style
     WHERE style.delete_up	IS NULL 
     ;
     `);

    const [row_scalar_all] = await connection.execute(`SELECT 
      id_scalar as id_sc, name_scalar as   name 
     FROM scalar
     WHERE scalar.delete_up	IS NULL 
     ;
     `);

    const [row_chance_all] = await connection.execute(`SELECT 
      id_chance as id_ch, detail as   name 
     FROM chance
     WHERE chance.delete_up	IS NULL 
     ;
     `);
    const [row_flower_imgall] = await connection.execute(
      `SELECT 
      id_image,  url_image 
     FROM image_all
     WHERE image_all.delete_at IS NULL 
     and id_bflower = ?
     ;
     `,
      [id_bflower]
    );

    const [row_paper] = await connection.execute(
      `SELECT 
      id_paper as id_p,  name_paper as name	, img_paper
     FROM paper
     WHERE paper.delete_up IS NULL 
     ;
     `
    );

    const [row_paper_moey] = await connection.execute(
      `SELECT 
      id_pm,  name_pm	as name ,img_pm
     FROM paper_money
     WHERE paper_money.delete_at IS NULL 
     ;
     `
    );

    const [row_acc] = await connection.execute(
      `SELECT 
      id_acc,  name_acc	 as name ,img_acc
     FROM accessories
     WHERE accessories.delete_at IS NULL 
     ;
     `
    );

    if (data_bflower.affectedRows === 0) {
      return res.status(404).json({ status: false, message: "ไม่พบข้อมูล" });
    }
    res.json({
      status: true,
      data: data_bflower,
      data_flower: row_flower_all,
      data_type_all: row_type_all,
      data_style_all: row_style_all,
      data_scalar_all: row_scalar_all,
      data_chance_all: row_chance_all,
      data_flower_imgall: row_flower_imgall,
      data_paper: row_paper,
      data_paper_money: row_paper_moey,
      data_accessories: row_acc,
    });
  } catch (err) {
    console.error("Error deleting cart item:", err);
    res.status(500).json({ status: false, message: "Server error" });
  } finally {
    connection.release(); // ปล่อย connection กลับไปที่ pool
  }
});

app.post("/update_bflower", authenticateToken, async (req, res) => {
  const connection = await getConnection();
  try {
    const {
      price = 0,
      name = "",
      typef_id = 0,
      scalar_id = 0,
      id_style = 0,
      id_flower = 0,
      chance_id = 0,
      description = "",
      paper_id = 0,
      paper_m_id = 0,
      acc_id = 0,
    } = req.body.bflowerData || {};
    const id_bflower = req.body.id_bflower;
    // console.log(req.body);

    const [updateResult] = await connection.execute(
      `UPDATE bunch_flowers 
       SET price = ?, name_code = ?, typef_id = ?, scalar_id = ?, 
           id_style = ?, id_flower = ?, chance_id = ?, description = ?, 
           paper_id = ?, paper_m_id = ?, acc_id = ? 
       WHERE delete_up IS NULL AND id_bflower = ?`,
      [
        price,
        name,
        typef_id,
        scalar_id,
        id_style,
        id_flower,
        chance_id,
        description,
        paper_id,
        paper_m_id,
        acc_id,
        id_bflower,
      ]
    );
    // console.log(updateResult)
    connection.release();

    if (updateResult.affectedRows > 0) {
      res.json({ status: true, message: "อัปเดตข้อมูลสำเร็จ" });
    } else {
      res.json({
        status: false,
        message: "ไม่พบข้อมูลหรือไม่มีการเปลี่ยนแปลง",
      });
    }
  } catch (err) {
    console.error("Error updating data:", err);
    res.status(500).json({ status: false, message: "Server error" });
  } finally {
    connection.release(); // ปล่อย connection กลับไปที่ pool
  }
});

// 📌 API สำหรับอัปโหลดรูปภาพ
app.post(
  "/upload_img_flower_admin",
  upload.single("image"),
  async (req, res) => {
    console.log("Upload directory path:", req.file);
    const connection = await getConnection();
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ status: false, message: "No file uploaded" });
      }

      const id_bflower = req.body.id_bflower;
      const imageUrl = `/assets/image_all/${req.file.filename}`; // เก็บพาธรูป

      // 📌 บันทึกข้อมูลลงฐานข้อมูล

      const [result] = await connection.execute(
        `INSERT INTO image_all (id_image, url_image, id_bflower) VALUES (UUID(), ?, ?)`,
        [imageUrl, id_bflower]
      );

      // ✅ ดึง `id_image` ที่เพิ่ง insert ไป (UUID ถูกสร้างโดย MySQL)
      const [newImage] = await connection.execute(
        `SELECT id_image FROM image_all WHERE url_image = ? LIMIT 1`,
        [imageUrl]
      );

      connection.release();

      // ✅ ส่ง `id_image` กลับไปที่ Frontend
      res.json({
        status: true,
        message: "อัปโหลดสำเร็จ",
        imageUrl,
        id_image: newImage[0].id_image, // **เพิ่มการส่ง id_image กลับ**
      });
    } catch (error) {
      console.error("Error uploading image:", error);
      res.status(500).json({ status: false, message: "Server error" });
    } finally {
      connection.release(); // ปล่อย connection กลับไปที่ pool
    }
  }
);

// 📌 ให้ Express เสิร์ฟไฟล์จาก `/assets/image_all/`
app.use(
  "/assets/image_all",
  express.static(path.join(__dirname, "assets/image_all"))
);

app.use(
  "/assets/mainpayment",
  express.static(path.join(__dirname, "assets/mainpayment"))
);
app.use(
  "/assets/payment",
  express.static(path.join(__dirname, "assets/payment"))
);

app.post("/del_img_flower_admin", authenticateToken, async (req, res) => {
  const connection = await getConnection();
  try {
    // console.log("Request Body:", req.body);
    const id_img_bflower = req.body.id_img_bflower; // ดึง id สินค้าที่ต้องการลบจาก body
    console.log(id_img_bflower);
    if (!id_img_bflower) {
      return res.status(400).json({ status: false, message: "Missing id" });
    }

    // console.log("Deleting item with ID:", id_img_bflower);

    const [deleteResult] = await connection.execute(
      `UPDATE image_all SET delete_at = NOW() WHERE id_image = ?`,
      [id_img_bflower]
    );
    connection.release();
    if (deleteResult.affectedRows === 0) {
      return res
        .status(404)
        .json({ status: false, message: "ไม่พบข้อมูลลูกค้า" });
    }

    res.json({
      status: true,
      message: "ลบข้อมูลลูกค้าออกเรียบร้อยแล้ว",
    });
  } catch (err) {
    console.error("Error deleting cart item:", err);
    res.status(500).json({ status: false, message: "Server error" });
  } finally {
    connection.release(); // ปล่อย connection กลับไปที่ pool
  }
});

// user_admin

app.post("/get_data_user_admin", authenticateToken, async (req, res) => {
  const connection = await getConnection();
  try {
    const [data_user] = await connection.execute(
      `select email,id_uc as id,fname,lname,nname,tel from user_customers WHERE delete_up IS NULL and role = 0 `
    );
    connection.release();
    if (data_user.affectedRows === 0) {
      return res
        .status(404)
        .json({ status: false, message: "ไม่พบข้อมูลลูกค้า" });
    }
    res.json({
      status: true,
      data: data_user,
    });
  } catch (err) {
    console.error("Error deleting cart item:", err);
    res.status(500).json({ status: false, message: "Server error" });
  } finally {
    connection.release(); // ปล่อย connection กลับไปที่ pool
  }
});

app.post("/del_user_admin", authenticateToken, async (req, res) => {
  const connection = await getConnection();
  try {
    // console.log("Request Body:", req.body);
    const id_user_customer = req.body.id_user_customer; // ดึง id สินค้าที่ต้องการลบจาก body
    console.log(id_user_customer);
    if (!id_user_customer) {
      return res.status(400).json({ status: false, message: "Missing id" });
    }

    // console.log("Deleting item with ID:", id_user_customer);

    const [deleteResult] = await connection.execute(
      `UPDATE user_customers SET delete_up = NOW() WHERE id_uc = ?`,
      [id_user_customer]
    );
    connection.release();
    if (deleteResult.affectedRows === 0) {
      return res
        .status(404)
        .json({ status: false, message: "ไม่พบข้อมูลลูกค้า" });
    }

    res.json({
      status: true,
      message: "ลบข้อมูลลูกค้าออกเรียบร้อยแล้ว",
    });
  } catch (err) {
    console.error("Error deleting cart item:", err);
    res.status(500).json({ status: false, message: "Server error" });
  } finally {
    connection.release(); // ปล่อย connection กลับไปที่ pool
  }
});

// console.log("Listening on port " + PORT);
app.get("/", (req, res) => {
  console.log("API called");
  res.send("Test API response");
});

console.log("Server initialization started...");
app.listen(PORT, (err) => {
  console.log("nodemon watching changes...");
  if (err) {
    console.error("Error starting the server:", err);
  } else {
    console.log(`Server running on http://localhost:${PORT}`);
  }
});

// const generateOrderID = () => {
//   const timestamp = Date.now(); // เวลาปัจจุบันในหน่วยมิลลิวินาที
//   const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0'); // ตัวเลขสุ่ม 3 หลัก
//   return `ORD${timestamp}${random}`; // ประกอบเป็นรหัส
// };

// const txt_id_order = generateOrderID();

// const sql = `
//   INSERT INTO bill_flower(status, status_send, send_flowers_id, txt_id_order, user_customers_id)
//   VALUES (?, ?, ?, ?, ?)
// `;

// // ค่าที่จะใช้ใน SQL
// const values = ['value-2', 'value-3', 'value-4', txt_id_order, 'value-6'];

// // Execute Query
// connection.execute(sql, values, (err, results) => {
//   if (err) {
//     console.error("Error inserting data:", err);
//     return;
//   }
//   console.log("Insert successful:", results);
// });
