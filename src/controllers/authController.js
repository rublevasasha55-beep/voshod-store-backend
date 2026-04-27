import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import prisma from '../prisma.js';

const OTP_EXPIRY_MINUTES  = 10;
const OTP_COOLDOWN_SECONDS = 60;
const OTP_MAX_ATTEMPTS    = 3;
const BCRYPT_ROUNDS       = 10;

function generateOtp() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function generatePassword() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#';
  return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// ─── POST /api/auth/send-otp ─────────────────────────────────────────────────

export async function sendOtp(req, res) {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Номер телефона обязателен' });

  const now = new Date();
  const user = await prisma.user.findUnique({ where: { phone } });

  if (user?.otpLastSent) {
    const elapsed = (now - user.otpLastSent) / 1000;
    if (elapsed < OTP_COOLDOWN_SECONDS) {
      const wait = Math.ceil(OTP_COOLDOWN_SECONDS - elapsed);
      return res.status(429).json({
        error: `Подождите ${wait} сек. перед повторной отправкой`,
        waitSeconds: wait,
      });
    }
  }

  const code    = generateOtp();
  const expires = new Date(now.getTime() + OTP_EXPIRY_MINUTES * 60 * 1000);

  // Upsert: обновляем OTP для существующего пользователя или создаём минимальную запись
  await prisma.user.upsert({
    where:  { phone },
    update: { otpCode: code, otpExpires: expires, otpAttempts: 0, otpLastSent: now },
    create: { phone, otpCode: code, otpExpires: expires, otpAttempts: 0, otpLastSent: now },
  });

  // Имитация SMS (в продакшене — вызов провайдера)
  console.log(`\n📱  OTP для ${phone}: ${code}  (действует ${OTP_EXPIRY_MINUTES} мин.)\n`);

  res.json({ message: 'Код отправлен', phone });
}

// ─── POST /api/auth/verify-and-register ──────────────────────────────────────

export async function verifyAndRegister(req, res) {
  const { phone, email, otpCode, acceptedTerms } = req.body;

  if (!phone || !email || !otpCode) {
    return res.status(400).json({ error: 'Телефон, email и код обязательны' });
  }
  if (!acceptedTerms) {
    return res.status(400).json({ error: 'Необходимо принять условия использования' });
  }

  const user = await prisma.user.findUnique({ where: { phone } });

  if (!user?.otpCode) {
    return res.status(400).json({ error: 'Сначала запросите код подтверждения' });
  }
  if (new Date() > user.otpExpires) {
    return res.status(400).json({ error: 'Код истёк — запросите новый' });
  }
  if (user.otpAttempts >= OTP_MAX_ATTEMPTS) {
    return res.status(429).json({ error: 'Слишком много неверных попыток — запросите новый код' });
  }

  if (user.otpCode !== String(otpCode)) {
    await prisma.user.update({
      where: { phone },
      data:  { otpAttempts: { increment: 1 } },
    });
    const left = OTP_MAX_ATTEMPTS - (user.otpAttempts + 1);
    return res.status(400).json({
      error: `Неверный код. Осталось попыток: ${left}`,
      attemptsLeft: left,
    });
  }

  // Проверяем, не занят ли email другим аккаунтом
  const emailTaken = await prisma.user.findFirst({
    where: { email, NOT: { phone } },
  });
  if (emailTaken) {
    return res.status(400).json({ error: 'Этот email уже используется другим аккаунтом' });
  }

  // Генерируем пароль и хэшируем
  const rawPassword    = generatePassword();
  const hashedPassword = await bcrypt.hash(rawPassword, BCRYPT_ROUNDS);

  // «Склейка»: пользователь мог быть заведён офлайн (есть телефон + баллы, но нет email)
  const isMerge = Boolean(user.email === null && user.bonusPoints > 0);

  const updated = await prisma.user.update({
    where: { phone },
    data: {
      email,
      password:     hashedPassword,
      acceptedTerms: true,
      otpCode:      null,
      otpExpires:   null,
      otpAttempts:  0,
    },
  });

  // Имитация отправки пароля на email
  console.log(`\n✉️   Пароль для ${email}: ${rawPassword}  (имитация письма)\n`);

  const token = jwt.sign({ userId: updated.id }, process.env.JWT_SECRET, { expiresIn: '7d' });

  res.status(201).json({
    message: isMerge
      ? `Аккаунт привязан к карте лояльности. Ваш бонусный баланс: ${updated.bonusPoints} баллов`
      : 'Регистрация прошла успешно',
    token,
    user: publicUser(updated),
  });
}

// ─── POST /api/auth/login ─────────────────────────────────────────────────────

export async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email и пароль обязательны' });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user?.password) {
    return res.status(401).json({ error: 'Неверный email или пароль' });
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    return res.status(401).json({ error: 'Неверный email или пароль' });
  }

  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });

  res.json({ token, user: publicUser(user) });
}

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────

export async function getMe(req, res) {
  const user = await prisma.user.findUnique({
    where:  { id: req.userId },
    select: {
      id: true, fullName: true, phone: true, email: true,
      bonusPoints: true, role: true, acceptedTerms: true, createdAt: true,
    },
  });

  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  res.json(user);
}

// ─── Утилиты ──────────────────────────────────────────────────────────────────

function publicUser(u) {
  return {
    id:           u.id,
    phone:        u.phone,
    email:        u.email,
    fullName:     u.fullName,
    bonusPoints:  u.bonusPoints,
    role:         u.role,
  };
}
