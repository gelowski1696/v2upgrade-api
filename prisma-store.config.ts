import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/store/schema.prisma',
  datasource: {
    url: process.env.STORE_SCHEMA_DATABASE_URL ?? 'file:./store-schema.sqlite',
  },
});
