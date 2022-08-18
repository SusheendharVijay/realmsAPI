import { z } from "zod";

export const WalletInfoSchema = z.object({
  pda: z.string(),
  gasTankPublicKey: z.string(),
  gasTankSecretKey: z.string(),
});
