import { z } from 'zod';

// Client-side copies of the contract's constraints. They give instant feedback; the server
// still validates everything and its 422 errors map onto the same fields (applyProblem).

export const loginSchema = z.object({
  email: z.email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
});

export const registerSchema = z.object({
  displayName: z.string().trim().min(1, 'Tell us your name').max(80),
  email: z.email('Enter a valid email address').max(254),
  password: z.string().min(8, 'At least 8 characters').max(128),
});

export const workspaceSchema = z.object({
  name: z.string().trim().min(1, 'Name your workspace').max(80),
  slug: z
    .string()
    .min(3, 'At least 3 characters')
    .max(40)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Lowercase letters, digits and single dashes'),
});

export const projectSchema = z.object({
  name: z.string().trim().min(1, 'Name your project').max(80),
  key: z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/, '2–10 capitals or digits, starting with a letter'),
  description: z.string().max(2000),
});

export const inviteSchema = z.object({
  email: z.email('Enter a valid email address'),
  role: z.enum(['admin', 'member', 'viewer']),
});

export const commentSchema = z.object({
  body: z.string().trim().min(1, 'Write something first').max(5000),
});

export type LoginValues = z.infer<typeof loginSchema>;
export type RegisterValues = z.infer<typeof registerSchema>;
export type WorkspaceValues = z.infer<typeof workspaceSchema>;
export type ProjectValues = z.infer<typeof projectSchema>;
export type InviteValues = z.infer<typeof inviteSchema>;
export type CommentValues = z.infer<typeof commentSchema>;
