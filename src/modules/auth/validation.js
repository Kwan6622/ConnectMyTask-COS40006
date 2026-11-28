const { z } = require('zod');

const signupSchema = z.object({
  fullName: z.string().min(3),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(['CLIENT', 'PROVIDER']),
  phone: z.string().optional(),
  wardId: z.number({ required_error: 'Choose your city and ward' }).int().positive(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

module.exports = {
  signupSchema,
  loginSchema,
};
