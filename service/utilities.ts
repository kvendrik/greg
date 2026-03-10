import { customAlphabet } from 'nanoid';

export const createUUID = () =>
  customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 10)(5);
