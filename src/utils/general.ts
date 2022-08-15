import { Connection, clusterApiUrl, Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { z } from "zod";
import { WalletInfoSchema } from "../../lib/types";

type IWalletInfo = z.infer<typeof WalletInfoSchema>;

export const getMainnetConnection = (): Connection => {
  const connection = new Connection(
    process.env.QUICKNODE_RPC as string,
    "recent"
  );

  return connection;
};

export const getDevnetConnection = (): Connection => {
  const connection = new Connection(clusterApiUrl("devnet"), "recent");

  return connection;
};
export const getGasTank = async (community: string): Promise<IWalletInfo> => {
  const res = await fetch(
    `http://localhost:3000/api/${community}/info?key=${process.env.API_KEY}`
  );

  const info = WalletInfoSchema.parse(await res.json());
  return info;
};

export const getKeypair = (): Keypair => {
  const LHT = Keypair.fromSecretKey(
    bs58.decode(process.env.LHT_SECRET_KEY as string)
  );

  return LHT;
};
