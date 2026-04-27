import { defineConfig } from '@prisma/config';

export default defineConfig({
  datasource: {
    // Вставляем строку прямо сюда, чтобы исключить ошибку с переменными окружения
    url: "postgresql://postgres:12345@localhost:5432/voskhod_db?schema=public",
  },
});