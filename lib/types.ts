import { z } from "zod";

export const WalletInfoSchema = z.object({
  pda: z.string(),
  tokenName: z.string(),
  tokenMint: z.string(),
  tokenDecimals: z.number(),
  gasTankPublicKey: z.string(),
  gasTankSecretKey: z.string(),
  created: z.string(),
});
