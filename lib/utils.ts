import { randomInt } from "crypto"
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const ALPHANUMERIC_CHARACTERS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"

export function generateRandomAlphanumericString(length = 6): string {
  let value = ""

  for (let index = 0; index < length; index++) {
    value += ALPHANUMERIC_CHARACTERS[randomInt(ALPHANUMERIC_CHARACTERS.length)]
  }

  return value
}
