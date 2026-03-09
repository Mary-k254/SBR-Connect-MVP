// Database module using raw SQL for Vercel Postgres / SQLite compatibility
// Uses pg library for PostgreSQL and better-sqlite3 for local development

import { Pool } from "pg";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { loadEnv } from "./env";

// Load environment configuration
const env = loadEnv();

// Determine if we're running on Vercel (has POSTGRES_URL env var)
const isVercel = env.isVercel;

// PostgreSQL connection pool for Vercel
let pgPool: Pool | null = null;

// SQLite for local development
let sqlite: Database.Database | null = null;

// Helper to convert ? placeholders to $1, $2, etc for PostgreSQL
function convertQuery(query: string): string {
  let paramIndex = 1;
  return query.replace(/\?/g, () => `$${paramIndex++}`);
}

// Get or create PostgreSQL pool
function getPgPool(): Pool {
  if (!pgPool) {
    // Use DATABASE_URL if POSTGRES_URL is not set (e.g., Supabase)
    const connectionString = env.POSTGRES_URL || env.DATABASE_URL;
    
    console.log("Creating PostgreSQL pool...");
    console.log("Connection string present:", !!connectionString);
    console.log("Is production:", env.isProduction);
    
    if (!connectionString) {
      const error = "No database connection string available. Please set POSTGRES_URL or DATABASE_URL environment variable in Vercel.";
      console.error("❌ " + error);
      console.error("Available env vars:", Object.keys(process.env).filter(k => k.includes('URL') || k.includes('DATABASE') || k.includes('POSTGRES')));
      throw new Error(error);
    }
    
    // Supabase requires specific SSL configuration
    const sslConfig = env.isProduction ? { 
      rejectUnauthorized: false,
      require: true,
    } : false;
    
    console.log("SSL config:", JSON.stringify(sslConfig));
    
    pgPool = new Pool({
      connectionString: connectionString,
      ssl: sslConfig,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    
    // Test the connection immediately
    pgPool.on('error', (err) => {
      console.error('PostgreSQL pool error:', err);
    });
    
    // Test connection on startup
    (async () => {
      try {
        const client = await pgPool!.connect();
        const result = await client.query('SELECT NOW()');
        console.log("✅ PostgreSQL connected, server time:", result.rows[0].now);
        client.release();
      } catch (err) {
        console.error("❌ PostgreSQL connection test failed:", err);
      }
    })();
  }
  return pgPool;
}

// Initialize the appropriate database based on environment
export async function initializeDatabase() {
  if (env.useSqlite) {
    // Local: Use SQLite
    console.log("Using local SQLite database");
    initializeSqlite();
  } else {
    // On Vercel: Use Postgres - tables should already exist
    console.log("Using Vercel Postgres database");
    await initializePostgresTables();
  }
}

async function initializePostgresTables() {
  // Create tables if they don't exist (PostgreSQL syntax)
  const pool = getPgPool();
  
  try {
    // Users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE,
        phone TEXT UNIQUE,
        password TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'passenger',
        profile_image TEXT,
        is_active INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // SACCOS table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS saccos (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        registration_number TEXT UNIQUE NOT NULL,
        manager_id INTEGER REFERENCES users(id),
        phone TEXT,
        email TEXT,
        address TEXT,
        is_active INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Routes table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS routes (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        origin TEXT NOT NULL,
        destination TEXT NOT NULL,
        origin_lat REAL NOT NULL,
        origin_lng REAL NOT NULL,
        dest_lat REAL NOT NULL,
        dest_lng REAL NOT NULL,
        distance_km REAL NOT NULL,
        base_fare_per_km REAL NOT NULL DEFAULT 10,
        estimated_duration_min INTEGER,
        is_active INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Vehicles table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vehicles (
        id SERIAL PRIMARY KEY,
        plate_number TEXT UNIQUE NOT NULL,
        model TEXT NOT NULL,
        capacity INTEGER NOT NULL DEFAULT 14,
        sacco_id INTEGER REFERENCES saccos(id),
        driver_id INTEGER REFERENCES users(id),
        route_id INTEGER REFERENCES routes(id),
        current_lat REAL,
        current_lng REAL,
        status TEXT DEFAULT 'inactive',
        last_location_update TIMESTAMP,
        is_gps_active INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Bookings table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id SERIAL PRIMARY KEY,
        passenger_id INTEGER NOT NULL REFERENCES users(id),
        vehicle_id INTEGER REFERENCES vehicles(id),
        route_id INTEGER NOT NULL REFERENCES routes(id),
        pickup_lat REAL NOT NULL,
        pickup_lng REAL NOT NULL,
        pickup_address TEXT,
        dropoff_lat REAL NOT NULL,
        dropoff_lng REAL NOT NULL,
        dropoff_address TEXT,
        distance_km REAL NOT NULL,
        fare_amount REAL NOT NULL,
        status TEXT DEFAULT 'pending',
        payment_status TEXT DEFAULT 'unpaid',
        payment_method TEXT,
        seat_number INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Trips table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS trips (
        id SERIAL PRIMARY KEY,
        driver_id INTEGER NOT NULL REFERENCES users(id),
        vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
        route_id INTEGER NOT NULL REFERENCES routes(id),
        start_time TIMESTAMP,
        end_time TIMESTAMP,
        distance_km REAL,
        passengers_count INTEGER DEFAULT 0,
        total_revenue REAL DEFAULT 0,
        status TEXT DEFAULT 'ongoing',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Payments table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        booking_id INTEGER NOT NULL REFERENCES bookings(id),
        passenger_id INTEGER NOT NULL REFERENCES users(id),
        amount REAL NOT NULL,
        method TEXT NOT NULL,
        transaction_id TEXT UNIQUE,
        status TEXT DEFAULT 'pending',
        phone_number TEXT,
        receipt TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Reviews table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS reviews (
        id SERIAL PRIMARY KEY,
        passenger_id INTEGER NOT NULL REFERENCES users(id),
        driver_id INTEGER NOT NULL REFERENCES users(id),
        trip_id INTEGER REFERENCES trips(id),
        booking_id INTEGER REFERENCES bookings(id),
        rating INTEGER NOT NULL,
        comment TEXT,
        is_reported INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Notifications table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        type TEXT NOT NULL,
        is_read INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Traffic alerts table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS traffic_alerts (
        id SERIAL PRIMARY KEY,
        route_id INTEGER REFERENCES routes(id),
        title TEXT NOT NULL,
        description TEXT,
        severity TEXT DEFAULT 'medium',
        lat REAL,
        lng REAL,
        is_active INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP
      )
    `);

    // Seed initial data
    await seedPostgresData(pool);
    console.log("Postgres tables initialized successfully!");
  } catch (error) {
    console.error("Error initializing Postgres tables:", error);
  }
}

async function seedPostgresData(pool: Pool) {
  try {
    // Check if routes already exist
    const result = await pool.query("SELECT COUNT(*) as count FROM routes");
    if (parseInt(result.rows[0].count) > 0) return;

    // Seed routes (major Kenyan matatu routes)
    await pool.query(`
      INSERT INTO routes (name, origin, destination, origin_lat, origin_lng, dest_lat, dest_lng, distance_km, base_fare_per_km, estimated_duration_min) VALUES
      ('Nairobi - Mombasa', 'Nairobi CBD', 'Mombasa', -1.2921, 36.8219, -4.0435, 39.6682, 480, 1.5, 480),
      ('Nairobi - Kisumu', 'Nairobi CBD', 'Kisumu', -1.2921, 36.8219, -0.0917, 34.7680, 350, 1.5, 360),
      ('Nairobi - Nakuru', 'Nairobi CBD', 'Nakuru', -1.2921, 36.8219, -0.3031, 36.0800, 160, 1.5, 120),
      ('Nairobi - Eldoret', 'Nairobi CBD', 'Eldoret', -1.2921, 36.8219, 0.5143, 35.2698, 310, 1.5, 300),
      ('Nairobi - Thika', 'Nairobi CBD', 'Thika', -1.2921, 36.8219, -1.0332, 37.0693, 45, 1.5, 60),
      ('Nairobi - Machakos', 'Nairobi CBD', 'Machakos', -1.2921, 36.8219, -1.5177, 37.2634, 65, 1.5, 75),
      ('Nairobi - Nyeri', 'Nairobi CBD', 'Nyeri', -1.2921, 36.8219, -0.4167, 36.9500, 155, 1.5, 150),
      ('Mombasa - Malindi', 'Mombasa', 'Malindi', -4.0435, 39.6682, -3.2138, 40.1169, 120, 1.5, 120)
    `);

    // Seed saccos
    await pool.query(`
      INSERT INTO saccos (name, registration_number, phone, email, address) VALUES
      ('Modern Coast Express', 'SACCO001', '+254700000001', 'info@moderncoast.co.ke', 'Nairobi CBD'),
      ('Easy Coach', 'SACCO002', '+254700000002', 'info@easycoach.co.ke', 'Nairobi CBD'),
      ('Mash Poa', 'SACCO003', '+254700000003', 'info@mashpoa.co.ke', 'Nairobi CBD'),
      ('Guardian Angel', 'SACCO004', '+254700000004', 'info@guardian.co.ke', 'Mombasa')
    `);

    // Seed traffic alerts
    await pool.query(`
      INSERT INTO traffic_alerts (route_id, title, description, severity, lat, lng) VALUES
      (1, 'Heavy Traffic at Mlolongo', 'Expect delays of 30-45 minutes near Mlolongo junction', 'high', -1.3500, 36.9000),
      (2, 'Road Works at Mai Mahiu', 'Single lane traffic due to road construction', 'medium', -0.9833, 36.5167),
      (3, 'Normal Traffic', 'Traffic flowing smoothly on Nakuru highway', 'low', -0.8000, 36.4000)
    `);

    console.log("Postgres data seeded successfully!");
  } catch (error) {
    console.error("Error seeding Postgres data:", error);
  }
}

function initializeSqlite() {
  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  sqlite = new Database(path.join(dataDir, "sqlite.db"));
  sqlite.pragma("journal_mode = WAL");

  // Create tables (SQLite syntax)
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE,
      phone TEXT UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'passenger',
      profile_image TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS saccos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      registration_number TEXT UNIQUE NOT NULL,
      manager_id INTEGER REFERENCES users(id),
      phone TEXT,
      email TEXT,
      address TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      origin TEXT NOT NULL,
      destination TEXT NOT NULL,
      origin_lat REAL NOT NULL,
      origin_lng REAL NOT NULL,
      dest_lat REAL NOT NULL,
      dest_lng REAL NOT NULL,
      distance_km REAL NOT NULL,
      base_fare_per_km REAL NOT NULL DEFAULT 10,
      estimated_duration_min INTEGER,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS vehicles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plate_number TEXT UNIQUE NOT NULL,
      model TEXT NOT NULL,
      capacity INTEGER NOT NULL DEFAULT 14,
      sacco_id INTEGER REFERENCES saccos(id),
      driver_id INTEGER REFERENCES users(id),
      route_id INTEGER REFERENCES routes(id),
      current_lat REAL,
      current_lng REAL,
      status TEXT DEFAULT 'inactive',
      last_location_update TEXT,
      is_gps_active INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      passenger_id INTEGER NOT NULL REFERENCES users(id),
      vehicle_id INTEGER REFERENCES vehicles(id),
      route_id INTEGER NOT NULL REFERENCES routes(id),
      pickup_lat REAL NOT NULL,
      pickup_lng REAL NOT NULL,
      pickup_address TEXT,
      dropoff_lat REAL NOT NULL,
      dropoff_lng REAL NOT NULL,
      dropoff_address TEXT,
      distance_km REAL NOT NULL,
      fare_amount REAL NOT NULL,
      status TEXT DEFAULT 'pending',
      payment_status TEXT DEFAULT 'unpaid',
      payment_method TEXT,
      seat_number INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS trips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      driver_id INTEGER NOT NULL REFERENCES users(id),
      vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
      route_id INTEGER NOT NULL REFERENCES routes(id),
      start_time TEXT,
      end_time TEXT,
      distance_km REAL,
      passengers_count INTEGER DEFAULT 0,
      total_revenue REAL DEFAULT 0,
      status TEXT DEFAULT 'ongoing',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL REFERENCES bookings(id),
      passenger_id INTEGER NOT NULL REFERENCES users(id),
      amount REAL NOT NULL,
      method TEXT NOT NULL,
      transaction_id TEXT UNIQUE,
      status TEXT DEFAULT 'pending',
      phone_number TEXT,
      receipt TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      passenger_id INTEGER NOT NULL REFERENCES users(id),
      driver_id INTEGER NOT NULL REFERENCES users(id),
      trip_id INTEGER REFERENCES trips(id),
      booking_id INTEGER REFERENCES bookings(id),
      rating INTEGER NOT NULL,
      comment TEXT,
      is_reported INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      type TEXT NOT NULL,
      is_read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS traffic_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER REFERENCES routes(id),
      title TEXT NOT NULL,
      description TEXT,
      severity TEXT DEFAULT 'medium',
      lat REAL,
      lng REAL,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT
    )
  `);

  // Seed initial data
  const result = sqlite.prepare("SELECT COUNT(*) as count FROM routes").get() as { count: number };
  if (result.count === 0) {
    sqlite.exec(`
      INSERT INTO routes (name, origin, destination, origin_lat, origin_lng, dest_lat, dest_lng, distance_km, base_fare_per_km, estimated_duration_min) VALUES
      ('Nairobi - Mombasa', 'Nairobi CBD', 'Mombasa', -1.2921, 36.8219, -4.0435, 39.6682, 480, 1.5, 480),
      ('Nairobi - Kisumu', 'Nairobi CBD', 'Kisumu', -1.2921, 36.8219, -0.0917, 34.7680, 350, 1.5, 360),
      ('Nairobi - Nakuru', 'Nairobi CBD', 'Nakuru', -1.2921, 36.8219, -0.3031, 36.0800, 160, 1.5, 120),
      ('Nairobi - Eldoret', 'Nairobi CBD', 'Eldoret', -1.2921, 36.8219, 0.5143, 35.2698, 310, 1.5, 300),
      ('Nairobi - Thika', 'Nairobi CBD', 'Thika', -1.2921, 36.8219, -1.0332, 37.0693, 45, 1.5, 60),
      ('Nairobi - Machakos', 'Nairobi CBD', 'Machakos', -1.2921, 36.8219, -1.5177, 37.2634, 65, 1.5, 75),
      ('Nairobi - Nyeri', 'Nairobi CBD', 'Nyeri', -1.2921, 36.8219, -0.4167, 36.9500, 155, 1.5, 150),
      ('Mombasa - Malindi', 'Mombasa', 'Malindi', -4.0435, 39.6682, -3.2138, 40.1169, 120, 1.5, 120)
    `);

    sqlite.exec(`
      INSERT INTO saccos (name, registration_number, phone, email, address) VALUES
      ('Modern Coast Express', 'SACCO001', '+254700000001', 'info@moderncoast.co.ke', 'Nairobi CBD'),
      ('Easy Coach', 'SACCO002', '+254700000002', 'info@easycoach.co.ke', 'Nairobi CBD'),
      ('Mash Poa', 'SACCO003', '+254700000003', 'info@mashpoa.co.ke', 'Nairobi CBD'),
      ('Guardian Angel', 'SACCO004', '+254700000004', 'info@guardian.co.ke', 'Mombasa')
    `);

    sqlite.exec(`
      INSERT INTO traffic_alerts (route_id, title, description, severity, lat, lng) VALUES
      (1, 'Heavy Traffic at Mlolongo', 'Expect delays of 30-45 minutes near Mlolongo junction', 'high', -1.3500, 36.9000),
      (2, 'Road Works at Mai Mahiu', 'Single lane traffic due to road construction', 'medium', -0.9833, 36.5167),
      (3, 'Normal Traffic', 'Traffic flowing smoothly on Nakuru highway', 'low', -0.8000, 36.4000)
    `);

    console.log("SQLite database seeded successfully!");
  }
}

// Execute a query - uses appropriate database based on environment
export async function dbQuery(query: string, params: any[] = []) {
  if (!env.useSqlite) {
    // Use Postgres with converted query
    const convertedQuery = convertQuery(query);
    const pool = getPgPool();
    const result = await pool.query(convertedQuery, params);
    return result.rows;
  } else {
    // Use SQLite
    if (!sqlite) initializeSqlite();
    const stmt = sqlite!.prepare(query);
    return params.length > 0 ? stmt.all(...params) : stmt.all();
  }
}

// Execute an insert/update/delete - returns the result
export async function dbExecute(query: string, params: any[] = []) {
  if (!env.useSqlite) {
    // Use Postgres with converted query
    const convertedQuery = convertQuery(query);
    const pool = getPgPool();
    const result = await pool.query(convertedQuery, params);
    return { lastInsertRowid: result.rowCount, rowsAffected: result.rowCount, rows: result.rows };
  } else {
    // Use SQLite
    if (!sqlite) initializeSqlite();
    const stmt = sqlite!.prepare(query);
    const result = params.length > 0 ? stmt.run(...params) : stmt.run();
    return { lastInsertRowid: result.lastInsertRowid, rowsAffected: result.changes };
  }
}

// Get a single row
export async function dbGet(query: string, params: any[] = []) {
  const rows = await dbQuery(query, params);
  return rows[0] || null;
}

// Get all rows
export async function dbAll(query: string, params: any[] = []) {
  return dbQuery(query, params);
}

// Insert and get the last insert ID
export async function dbInsert(query: string, params: any[] = []) {
  console.log("dbInsert called, useSqlite:", env.useSqlite);
  
  if (!env.useSqlite) {
    // Use Postgres - need to use RETURNING id in query
    try {
      const convertedQuery = convertQuery(query);
      console.log("PostgreSQL query:", convertedQuery);
      console.log("Parameters:", params);
      
      const pool = getPgPool();
      const result = await pool.query(convertedQuery, params);
      console.log("Query result:", result.rows);
      
      // For PostgreSQL with RETURNING id, the id is in the first row
      if (result.rows && result.rows.length > 0) {
        return result.rows[0].id;
      }
      return result.rowCount;
    } catch (error) {
      console.error("PostgreSQL insert error:", error);
      throw error;
    }
  } else {
    // Use SQLite
    const result = await dbExecute(query, params);
    return result.lastInsertRowid;
  }
}

// Export for direct access when needed
export { sqlite };
