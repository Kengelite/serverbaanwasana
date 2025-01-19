const express = require("express");
const { exec, spawn } = require("child_process");
const fs = require("fs");
const cors = require("cors");
const path = require("path");
const mysql = require("mysql2/promise");
const { v4: uuidv4 } = require("uuid");
const jwt = require("jsonwebtoken");
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

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // ดึง token ออกจาก "Bearer <token>"
  console.log(token);
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
  connection = await pool.getConnection();
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
    bf.delete_up IS NULL -- แก้ไขให้ตรวจสอบในตารางที่มีจริง
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
  connection = await pool.getConnection();
  let type = req.query.select_type;
  // console.log(type)
  try {
    let rows; // ตัวแปรสำหรับเก็บผลลัพธ์จาก query
    let rows_total; // ตัวแปรสำหรับเก็บผลรวมจาก query

    if (type === 1) {
      // ใช้ === เพื่อตรวจสอบชนิดข้อมูลอย่างเคร่งครัด
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
ON 
    bf.id_bflower = img.id_bflower 
WHERE 
    bf.delete_up IS NULL -- แก้ไขให้ตรวจสอบในตารางที่มีจริง
GROUP BY 
    bf.id_bflower
LIMIT 10;
      `);
      [rows_total] = await connection.execute(`
        SELECT COUNT(*) AS total FROM bunch_flowers
        WHERE 
    bunch_flowers.delete_up IS NULL
      `);
    } else if (type == 2) {
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
ON 
    bf.id_bflower = img.id_bflower 
WHERE 
    bf.delete_up IS NULL -- แก้ไขให้ตรวจสอบในตารางที่มีจริง
GROUP BY 
    bf.id_bflower
ORDER BY price ASC;
      `);
      [rows_total] = await connection.execute(`
        SELECT COUNT(*) AS total FROM bunch_flowers
      `);
    } else {
      [rows] = await connection.execute(`
        SELECT 
    bf.id_bflower, 
    bf.name_code, 
    bf.price, 
    bf.description, 
    MIN(img.url_image) AS url_image
FROM 
    bunch_flowers AS bf
LEFT JOIN 
    image_all AS img 
ON 
    bf.id_bflower = img.id_bflower
WHERE 
    bf.delete_up IS NULL -- แก้ไขให้ตรวจสอบในตารางที่มีจริง
GROUP BY 
    bf.id_bflower
        ORDER BY price DESC;
      `);

      [rows_total] = await connection.execute(`
        SELECT COUNT(*) AS total FROM bunch_flowers
        WHERE 
    bunch_flowers.delete_up IS NULL -- แก้ไขให้ตรวจสอบในตารางที่มีจริง
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

app.post("/select_detail_flower", async (req, res) => {
  let select_id_flower = req.body.id_select;
  // console.log(select_id_flower)
  try {
    const [rows_img] = await pool.execute(
      `SELECT img.url_image as url FROM bunch_flowers  as bf
LEFT JOIN 
    image_all AS img 
ON 
    bf.id_bflower = img.id_bflower
where bf.id_bflower  = ?  and 
    bf.delete_up IS NULL
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
    bf.delete_up IS NULL
      `,
      [select_id_flower]
    );
    // console.log(rows)
    res.json({ data_img: rows_img, data: rows_data });
  } catch (error) {
    console.error("Error executing query:", error);
    res.status(500).send("Error retrieving data");
  }
});
app.get("/datainvolve", async (req, res) => {
  connection = await pool.getConnection();
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
    bf.delete_up IS NULL
  GROUP BY 
      bf.id_bflower
      limit 10
      ;
        `);
    res.json({ data: rows, total: rows_total, data_best: rows_best });
  } catch (err) {
    res.status(500).send("Can't get Data request");
  }
});

app.post("/check-login", async (req, res) => {
  let connection;
  const { email, pwd } = req.body;

  try {
    connection = await getConnection();
    const [rows] = await connection.execute(
      `SELECT id_uc as id ,email,role,nname as nickname FROM user_customers
      WHERE email = ? AND pwd = ?   and  
    user_customers.delete_up IS NULL`,
      [email, pwd]
    );

    if (rows.length > 0) {
      const user = rows[0];
      const payload = {
        id: user.id_uc,
        nickname: user.nickname,
        role: user.role,
      };

      const token = jwt.sign(payload, process.env.JWT_SECRET_KEY, {
        expiresIn: "1d",
      });
      // console.log(token)
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
    // console.log(req.body)
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

    // เพิ่มข้อมูลผู้ใช้ใหม่
    await connection.execute(
      `INSERT INTO user_customers (id_uc,email, pwd, fname, lname, nname, tel) 
       VALUES (uuid(),?, ?, ?, ?, ?, ?)`,
      [email, pwd, fname, lname, nname, tel] // กำหนด role เป็น "user" โดยค่าเริ่มต้น
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
    // console.log('ss')
  } catch (err) {
    console.error("Error during registration:", err);
    res.status(500).json({ status: false, message: "Server error" });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

app.post("/profile", authenticateToken, async (req, res) => {
  try {
    const userId = req.body.userId; // ดึง user id จาก token
    const connection = await getConnection();
    // console.log(userId);
    const [user] = await connection.execute(
      `SELECT id_uc, fname, lname, email, nname, tel FROM user_customers WHERE id_uc = ? and  
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
  }
});

app.post("/check_cart", authenticateToken, async (req, res) => {
  try {
    const userId = req.body.userId; // ดึง user id จาก token
    const connection = await getConnection();
    // console.log(userId);
    const [user] = await connection.execute(
      `SELECT 
    bdf.id_detail_flower AS id,
    bunf.name_code AS name,
    bunf.price,
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
GROUP BY 
    bdf.id_detail_flower, bunf.name_code, bunf.price, bdf.amount;`,
      [userId]
    );

    if (user.length === 0) {
      return res.status(404).json({ status: false, message: "User not found" });
    }

    res.json({
      status: true,
      data: user,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: false, message: "Server error" });
  }
});

app.delete("/del_detail_cart", authenticateToken, async (req, res) => {
  try {
    // console.log("Request Body:", req.body);
    const bill_detail_id = req.body.bill_detail_id; // ดึง id สินค้าที่ต้องการลบจาก body
    if (!bill_detail_id) {
      return res
        .status(400)
        .json({ status: false, message: "Missing bill_detail_id" });
    }

    const connection = await getConnection();
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
  }
});

app.put("/add_cart", authenticateToken, async (req, res) => {
  let connection;
  const { id_bflower, amount, user_id, price } = req.body;
  console.log(req.body);

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
        `INSERT INTO bill_flower (id_bill_flower, user_customers_id, status) 
         VALUES (uuid(), ?, 0)`,
        [user_id]
      );

      // รับ ID ของบิลใหม่
      const [createdBill] = await connection.execute(
        `SELECT id_bill_flower FROM bill_flower 
         WHERE user_customers_id = ? AND status = 0 
         ORDER BY created_at DESC LIMIT 1`,
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
        `INSERT INTO bill_detail_flower (id_detail_flower, bill_id_flower, id_bflower, amount, price) 
         VALUES (uuid(), ?, ?, ?, ?)`,
        [billId, id_bflower, amount, price]
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
  try {
    const connection = await getConnection();
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

    if (row.length === 0) {
      return res.status(404).json({ status: false, message: "ไม่พบข้อมูล" });
    }

    res.json({
      status: true,
      data: row,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: false, message: "Server error" });
  }
});

app.post("/type_data_admin", authenticateToken, async (req, res) => {
  try {
    const connection = await getConnection();
    // console.log(userId);
    const [row] =
      await connection.execute(`SELECT id_tf as id, name_type_flower as name FROM type_flower where delete_up IS NULL
`);
    const [row_group_count] = await connection.execute(`SELECT 
    type_flower.name_type_flower AS name,
    COALESCE(COUNT(bunch_flowers.id_bflower), 0) As total
FROM 
    type_flower
LEFT JOIN 
    bunch_flowers 
ON 
    type_flower.id_tf = bunch_flowers.typef_id
WHERE 
    type_flower.delete_up IS NULL 
    AND (bunch_flowers.delete_up IS NULL OR bunch_flowers.id_bflower IS NULL)
GROUP BY 
    type_flower.id_tf, type_flower.name_type_flower;
`);
    if (row.length === 0) {
      return res.status(404).json({ status: false, message: "ไม่พบข้อมูล" });
    }

    res.json({
      status: true,
      data: row,
      data_group: row_group_count,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: false, message: "Server error" });
  }
});

app.post("/flower_data_admin", authenticateToken, async (req, res) => {
  try {
    const connection = await getConnection();
    // console.log(userId);
    const [row_total] =
      await connection.execute(`select count(id_flower) as total from flowers where delete_up IS NULL
`);
    const [row_available] = await connection.execute(`SELECT 
    COUNT(id_flower) AS total_available 
FROM  
    flowers
WHERE 
    delete_up IS NULL 
    AND FLOOR(amount_flower/ratio_flower) > 3;
`);

    const [row_almost] = await connection.execute(`SELECT 
    COUNT(id_flower) AS total_almost
FROM  
    flowers
WHERE 
    delete_up IS NULL 
    AND FLOOR(amount_flower/ratio_flower) BETWEEN 1 AND 3;
`);
    const [row_sold_out] = await connection.execute(`SELECT 
    COUNT(id_flower) AS total_sold_out 
FROM  
    flowers
WHERE 
    delete_up IS NULL 
    AND FLOOR(amount_flower/ratio_flower) = 0;
`);

    const [row_flower] =
      await connection.execute(`select id_flower,name,url_image as image,FLOOR(amount_flower/ratio_flower) as available, amount_flower as amount from flowers where delete_up IS NULL
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
      data_total: row_total,
      data_available: row_available,
      data_almost: row_almost,
      data_sold_out: row_sold_out,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: false, message: "Server error" });
  }
});

app.post("/bunch_flower_admin", authenticateToken, async (req, res) => {
  try {
    const connection = await getConnection();
    // console.log(userId);
    const [row_total] =
      await connection.execute(`select count(id_bflower) as total from bunch_flowers where delete_up IS NULL
`);
    const [row_available] = await connection.execute(`
  SELECT  COUNT(bunch_flowers.id_bflower) AS total_available  FROM bunch_flowers
LEFT join flowers on bunch_flowers.id_flower = flowers.id_flower
WHERE bunch_flowers.delete_up IS NULL 
AND FLOOR(amount_flower/ratio_flower) > 3
`);

    const [row_almost] = await connection.execute(`SELECT 
    COUNT(bunch_flowers.id_bflower) AS total_almost
FROM bunch_flowers
LEFT join flowers on bunch_flowers.id_flower = flowers.id_flower
WHERE bunch_flowers.delete_up IS NULL 
AND  FLOOR(amount_flower/ratio_flower) BETWEEN 1 AND 3;
`);
    const [row_sold_out] = await connection.execute(`SELECT 
    COUNT(bunch_flowers.id_bflower) AS total_sold_out 
FROM bunch_flowers
LEFT join flowers on bunch_flowers.id_flower = flowers.id_flower
WHERE bunch_flowers.delete_up IS NULL 
AND FLOOR(amount_flower/ratio_flower) = 0;
`);

    const [row_flower] = await connection.execute(`
    SELECT 
    bunch_flowers.id_bflower as id,
    bunch_flowers.name_code as name,
    MIN(image_all.url_image) AS image, -- เลือก URL รูปแรก (ตามลำดับการจัดเก็บ)
    FLOOR(amount_flower / ratio_flower) AS available,
	  flowers.amount_flower as amount,
    bunch_flowers.status_flowers as status,
    price
FROM 
    bunch_flowers
LEFT JOIN 
    flowers ON bunch_flowers.id_flower = flowers.id_flower
LEFT JOIN 
    image_all ON bunch_flowers.id_bflower = image_all.id_bflower
WHERE 
    bunch_flowers.delete_up IS NULL
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
      data_total: row_total,
      data_available: row_available,
      data_almost: row_almost,
      data_sold_out: row_sold_out,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: false, message: "Server error" });
  }
});

app.get("/", (req, res) => {
  res.send("Hello Backend!");
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
