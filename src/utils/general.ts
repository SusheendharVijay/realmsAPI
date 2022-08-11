import { Connection, clusterApiUrl, Keypair } from "@solana/web3.js";
import bs58 from "bs58";

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

export const getKeypair = (): Keypair => {
  const LHT = Keypair.fromSecretKey(
    bs58.decode(process.env.LHT_SECRET_KEY as string)
  );

  return LHT;
};
