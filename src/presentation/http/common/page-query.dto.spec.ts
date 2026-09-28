import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PageQueryDto } from './page-query.dto.js';

describe('PageQueryDto', () => {
  it('converts valid query-string pagination values to numbers', async () => {
    const query = plainToInstance(
      PageQueryDto,
      { page: '1', pageSize: '20' },
      { enableImplicitConversion: true },
    );

    await expect(validate(query)).resolves.toHaveLength(0);
    expect(query.page).toBe(1);
    expect(query.pageSize).toBe(20);
  });

  it('rejects page values below one', async () => {
    const query = plainToInstance(PageQueryDto, {
      page: '0',
      pageSize: '20',
    });

    const errors = await validate(query);

    expect(errors.some((error) => error.property === 'page')).toBe(true);
  });
});
