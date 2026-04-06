"use server";

import { db } from "@/lib/prisma";

export async function checkInviteToken(token: string) {
    if (!token) return { valid: false, message: "Token is required" };

    try {
        const tokenRecord = await db.allowedToken.findUnique({
            where: {
                token: token,
            },
        });

        if (!tokenRecord) {
            return { valid: false, message: "Token not found" };
        }

        if (tokenRecord.is_used) {
            return { valid: false, message: "Token has already been used" };
        }

        return { valid: true };
    } catch (error) {
        console.error("Error finding token:", error);
        return { valid: false, message: "Internal Server Error" };
    }
}

export async function checkUserEmail(email: string) {
    if (!email) return { valid: false, message: "Email is required" };

    try {
        const user = await db.allowedToken.findUnique({
            where: { email: email }
        });

        if (user) {
            return { valid: true, message: "User is already signed in" };
        } else {
            return { valid: false, message: "User not found" };
        }
    } catch (error) {
        console.error("Error finding user:", error);
        return { valid: false, message: "Internal Server Error" };
    }
}
