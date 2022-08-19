import {
  getGovernanceAccounts,
  getRealm,
  pubkeyFilter,
  TokenOwnerRecord,
} from "@solana/spl-governance";
import { PublicKey } from "@solana/web3.js";
import type { NextApiRequest, NextApiResponse } from "next";
import { z, ZodError } from "zod";
import { getDevnetConnection } from "../../utils/general";
import { TEST_PROGRAM_ID } from "../../utils/realmUtils";

const GetStewardsSchema = z.object({
  realmPk: z.string().transform((v) => new PublicKey(v)),
});

const getMultisigStewards = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  try {
    const connection = getDevnetConnection();
    const { realmPk } = GetStewardsSchema.parse(req.body);

    const realm = await getRealm(connection, realmPk);
    const tokenOwnerRecords = await getGovernanceAccounts(
      connection,
      TEST_PROGRAM_ID,
      TokenOwnerRecord,
      [
        pubkeyFilter(1, realmPk)!,
        pubkeyFilter(33, realm.account.config.councilMint)!,
      ]
    );

    const stewards = tokenOwnerRecords.map((record) =>
      record.account.governingTokenOwner.toBase58()
    );

    res.status(200).json({ stewards });
  } catch (error) {
    console.log(error);

    if (error instanceof ZodError)
      return res.status(406).json({ error: error.flatten() });

    return res.status(500).json({ error });
  }
};

export default getMultisigStewards;
