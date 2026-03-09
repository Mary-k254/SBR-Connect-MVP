import { NextRequest, NextResponse } from "next/server";
import { dbQuery, dbGet, dbInsert, initializeDatabase } from "@/lib/db";
import { hashPassword, generateToken, setAuthCookie } from "@/lib/auth";
import { rateLimitMiddleware, addRateLimitHeaders } from "@/lib/rate-limit";

initializeDatabase();

export async function POST(request: NextRequest) {
  // Apply rate limiting
  const rateLimitResponse = rateLimitMiddleware(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }
  
  try {
    const body = await request.json();
    const { name, email, phone, password, role } = body;

    if (!name || !password || (!email && !phone)) {
      return NextResponse.json(
        { error: "Name, password, and email or phone are required" },
        { status: 400 }
      );
    }

    if (!["passenger", "driver", "manager"].includes(role || "passenger")) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters" },
        { status: 400 }
      );
    }

    // Check if user already exists
    const existingUser = await dbGet(
      "SELECT id FROM users WHERE email = ? OR phone = ?",
      [email || null, phone || null]
    );

    if (existingUser) {
      return NextResponse.json(
        { error: "User with this email or phone already exists" },
        { status: 409 }
      );
    }

    const hashedPassword = await hashPassword(password);
    const userRole = role || "passenger";

    // Insert new user - use RETURNING id for PostgreSQL compatibility
    const insertResult = await dbInsert(
      "INSERT INTO users (name, email, phone, password, role) VALUES (?, ?, ?, ?, ?) RETURNING id",
      [name, email || null, phone || null, hashedPassword, userRole]
    );

    // Get the created user
    const newUser = await dbGet(
      "SELECT id, name, email, phone, role FROM users WHERE id = ?",
      [insertResult]
    );

    if (!newUser) {
      return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
    }

    const token = await generateToken({
      userId: newUser.id,
      email: newUser.email || undefined,
      phone: newUser.phone || undefined,
      role: newUser.role as "passenger" | "driver" | "manager",
      name: newUser.name,
    });

    const cookieOptions = setAuthCookie(token);
    const response = NextResponse.json({
      success: true,
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        phone: newUser.phone,
        role: newUser.role,
      },
      token,
    });

    response.cookies.set(cookieOptions);
    return addRateLimitHeaders(response, request);
  } catch (error) {
    console.error("Registration error:", error);
    
    // Provide more detailed error message
    if (error instanceof Error) {
      if (error.message.includes("database connection")) {
        return NextResponse.json(
          { error: "Database connection failed. Please check environment configuration." },
          { status: 500 }
        );
      }
      return NextResponse.json(
        { error: "Registration failed: " + error.message },
        { status: 500 }
      );
    }
    
    return NextResponse.json({ error: "Registration failed" }, { status: 500 });
  }
}
