import { z } from "zod";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

const feet = (max: number) => z.coerce.number().min(0).max(max);

export const vehicleSchema = z.object({
  vehicle_type: z.string().trim().min(1, "Vehicle type is required").max(80),
  description: optionalText(200),
  length_ft: z.coerce.number().positive("Length must be greater than 0").max(120),
  width_ft: z.coerce.number().positive().max(20).optional().nullable(),
  height_ft: z.coerce.number().positive().max(20).optional().nullable(),
  is_towing: z.boolean().default(false),
  trailer_length_ft: feet(80).default(0),
  driver_name: optionalText(120),
});

export type VehicleInput = z.infer<typeof vehicleSchema>;

export const organizationSchema = z.object({
  name: z.string().trim().min(1, "Organization name is required").max(160),
  contact_name: optionalText(120),
  contact_email: z.string().trim().email("Enter a valid email").max(200).optional().or(z.literal("")),
  contact_phone: optionalText(40),
  mailing_address: optionalText(300),
  website: optionalText(200),
});

export const applicationSchema = z.object({
  entry_name: z.string().trim().min(1, "Entry name is required").max(160),
  category_id: z.string().uuid("Choose a category"),
  purpose: optionalText(1000),
  responsible_contact_name: z.string().trim().min(1, "Responsible contact is required").max(120),
  responsible_contact_phone: z.string().trim().min(7, "A phone number is required").max(40),
  responsible_contact_email: z.string().trim().email("Enter a valid email").max(200),
  participant_count: z.coerce.number().int().min(0).max(5000),
  footprint_length_ft: feet(1000),
  footprint_width_ft: feet(40),
  has_animals: z.boolean(),
  has_amplified_sound: z.boolean(),
  safety_requirements: optionalText(2000),
  accessibility_needs: optionalText(2000),
  public_name: optionalText(160),
  public_description: optionalText(1000),
});

export type ApplicationInput = z.infer<typeof applicationSchema>;

export function fieldErrors(error: z.ZodError, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = prefix + issue.path.join(".");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
