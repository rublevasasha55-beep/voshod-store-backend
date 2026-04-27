/*
  Warnings:

  - You are about to drop the column `cardNumber` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `loyaltyPoints` on the `User` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[phone]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "User" DROP COLUMN "cardNumber",
DROP COLUMN "loyaltyPoints",
ADD COLUMN     "acceptedTerms" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "bonusPoints" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "otpAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "otpCode" TEXT,
ADD COLUMN     "otpExpires" TIMESTAMP(3),
ADD COLUMN     "otpLastSent" TIMESTAMP(3),
ALTER COLUMN "fullName" DROP NOT NULL,
ALTER COLUMN "email" DROP NOT NULL,
ALTER COLUMN "password" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");
