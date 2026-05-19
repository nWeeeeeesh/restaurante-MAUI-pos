import { z } from 'zod'

export const SplitGroupsSchema = z.object({
  groups: z.array(z.object({
    label: z.string().trim().min(1).max(40),
    itemIds: z.array(z.number().int().positive()).max(500),
  })).max(20),
})

export type SplitGroupsInput = z.infer<typeof SplitGroupsSchema>
