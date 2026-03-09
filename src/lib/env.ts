/**
 * Environment Variables Loader
 * 
 * This module provides a centralized way to load and validate environment variables.
 * It automatically:
 * - Detects if running on Vercel (via POSTGRES_URL)
 * - Falls back to SQLite for local development
 * - Generates a secure JWT_SECRET if not provided
 * - Validates required variables at server startup
 */

import { randomBytes } from "crypto";

// =====================================================
// Type Definitions
// =====================================================

export interface EnvConfig {
  // Database
  POSTGRES_URL: string | undefined;
  DATABASE_URL: string | undefined;  // Supabase and other providers use this
  isProduction: boolean;
  isVercel: boolean;
  useSqlite: boolean;
  
  // Authentication
  JWT_SECRET: string;
  
  // API Configuration
  NODE_ENV: "development" | "production" | "test";
  API_URL: string;
  API_RATE_LIMIT: number;
  
  // M-Pesa (Optional)
  MPESA_CONSUMER_KEY: string | undefined;
  MPESA_CONSUMER_SECRET: string | undefined;
  MPESA_SHORTCODE: string | undefined;
  MPESA_PASSKEY: string | undefined;
  MPESA_ENV: "development" | "production";
  
  // External APIs (Optional)
  MAPS_API_KEY: string | undefined;
  SMS_API_KEY: string | undefined;
}

// =====================================================
// Default Values
// =====================================================

const DEFAULTS = {
  NODE_ENV: "development" as const,
  API_URL: "http://localhost:3000",
  API_RATE_LIMIT: 100,
  MPESA_ENV: "development" as const,
};

// =====================================================
// Private Helper Functions
// =====================================================

/**
 * Check if we're running on Vercel or have a database URL
 * Vercel automatically sets POSTGRES_URL when using Vercel Postgres
 * Supabase and other providers may use DATABASE_URL
 */
function detectVercel(): boolean {
  return !!(process.env.POSTGRES_URL || process.env.DATABASE_URL);
}

/**
 * Check if we should use SQLite (local development)
 */
function shouldUseSqlite(): boolean {
  return !(process.env.POSTGRES_URL || process.env.DATABASE_URL);
}

/**
 * Generate a secure random JWT_SECRET
 */
function generateJwtSecret(): string {
  // Generate 32 bytes of random data and convert to hex
  return randomBytes(32).toString("hex");
}

/**
 * Get JWT_SECRET from environment or generate one
 */
function getJwtSecret(): string {
  if (process.env.JWT_SECRET) {
    return process.env.JWT_SECRET;
  }
  
  // Generate a new secret if not provided
  const generatedSecret = generateJwtSecret();
  
  // Only log in development
  if (process.env.NODE_ENV === "development") {
    console.warn("⚠️  JWT_SECRET not set. Generated a secure secret for this session.");
    console.warn("⚠️  For production, set a persistent JWT_SECRET in your environment variables.");
  }
  
  return generatedSecret;
}

/**
 * Validate required environment variables
 */
function validateEnv(config: EnvConfig): void {
  const errors: string[] = [];
  
  // In production, we require either POSTGRES_URL or DATABASE_URL
  const hasDatabaseUrl = config.POSTGRES_URL || config.DATABASE_URL;
  if (config.isProduction && !hasDatabaseUrl) {
    errors.push("POSTGRES_URL or DATABASE_URL is required in production");
  }
  
  // JWT_SECRET should always be set (we generate one if missing)
  if (!config.JWT_SECRET) {
    errors.push("JWT_SECRET is required");
  }
  
  if (errors.length > 0) {
    console.error("❌ Environment validation failed:");
    errors.forEach(err => console.error(`   - ${err}`));
    
    // In development, we continue with defaults
    // In production, we throw an error
    if (config.isProduction) {
      throw new Error("Environment validation failed. Please check your environment variables.");
    }
  }
}

// =====================================================
// Main Load Function
// =====================================================

let cachedConfig: EnvConfig | null = null;

/**
 * Load and validate environment variables
 * This function is idempotent - it caches the result after first call
 */
export function loadEnv(): EnvConfig {
  // Return cached config if already loaded
  if (cachedConfig) {
    return cachedConfig;
  }
  
  // Detect environment
  const isVercel = detectVercel();
  const useSqlite = shouldUseSqlite();
  const nodeEnv = (process.env.NODE_ENV as EnvConfig["NODE_ENV"]) || DEFAULTS.NODE_ENV;
  
  // Build configuration
  const config: EnvConfig = {
    // Database
    POSTGRES_URL: process.env.POSTGRES_URL,
    DATABASE_URL: process.env.DATABASE_URL,
    isProduction: nodeEnv === "production",
    isVercel,
    useSqlite,
    
    // Authentication
    JWT_SECRET: getJwtSecret(),
    
    // API Configuration
    NODE_ENV: nodeEnv,
    API_URL: process.env.API_URL || DEFAULTS.API_URL,
    API_RATE_LIMIT: parseInt(process.env.API_RATE_LIMIT || String(DEFAULTS.API_RATE_LIMIT), 10),
    
    // M-Pesa (Optional)
    MPESA_CONSUMER_KEY: process.env.MPESA_CONSUMER_KEY,
    MPESA_CONSUMER_SECRET: process.env.MPESA_CONSUMER_SECRET,
    MPESA_SHORTCODE: process.env.MPESA_SHORTCODE,
    MPESA_PASSKEY: process.env.MPESA_PASSKEY,
    MPESA_ENV: (process.env.MPESA_ENV as EnvConfig["MPESA_ENV"]) || DEFAULTS.MPESA_ENV,
    
    // External APIs (Optional)
    MAPS_API_KEY: process.env.MAPS_API_KEY,
    SMS_API_KEY: process.env.SMS_API_KEY,
  };
  
  // Validate configuration
  validateEnv(config);
  
  // Log environment info in development
  if (nodeEnv === "development") {
    console.log("📦 Environment Configuration:");
    console.log(`   Mode: ${config.isVercel ? "Vercel (PostgreSQL)" : "Local (SQLite)"}`);
    console.log(`   Database: ${config.useSqlite ? "SQLite" : "PostgreSQL"}`);
    console.log(`   API URL: ${config.API_URL}`);
    console.log(`   Rate Limit: ${config.API_RATE_LIMIT} req/min`);
  }
  
  // Cache the config
  cachedConfig = config;
  
  return config;
}

/**
 * Get a specific environment variable with fallback
 */
export function getEnvVar(key: keyof EnvConfig, fallback?: string): string {
  const config = loadEnv();
  return (config[key] as string) || fallback || "";
}

/**
 * Check if M-Pesa is configured
 */
export function isMpesaConfigured(): boolean {
  const config = loadEnv();
  return !!(config.MPESA_CONSUMER_KEY && config.MPESA_CONSUMER_SECRET && config.MPESA_SHORTCODE);
}

/**
 * Check if external APIs are configured
 */
export function areExternalApisConfigured(): boolean {
  const config = loadEnv();
  return !!(config.MAPS_API_KEY || config.SMS_API_KEY);
}

// =====================================================
// Server-Side Only Export
// =====================================================

// This ensures the environment is loaded at server startup
// and makes env available throughout the application
if (typeof window === "undefined") {
  // Load environment on module initialization (server-side only)
  try {
    loadEnv();
  } catch (error) {
    console.error("Failed to load environment:", error);
  }
}

export default loadEnv;
