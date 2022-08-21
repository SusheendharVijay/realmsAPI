import {
  withCreateAssociatedTokenAccount,
  withMintTo,
} from "./../../../utils/realmUtils";
import { getGasTank, getDevnetConnection } from "../../../utils/general";
import { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import bs58 from "bs58";
import { Ok, Err, Result } from "ts-results";

import { withCreateProposal, VoteType } from "@solana/spl-governance";
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  Keypair,
} from "@solana/web3.js";
import {
  getRealmInfo,
  getSerializedTxns,
  insertInstructionsAndSignOff,
} from "../../../utils/realmUtils";
import { getMint } from "@solana/spl-token";

const TEST_PROGRAM_ID = new PublicKey(
  "GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw"
);

const connection = getDevnetConnection();

const InstructionSchema = z.object({
  serializedTxn: z.array(z.number()),
});

const pubkeySchema = z.string().transform((v) => new PublicKey(v));

const AddAdminSchema = z.object({
  newAdmin: pubkeySchema,
  proposer: pubkeySchema,
  realmPk: pubkeySchema,
});

const addPointsProposal = async (req: NextApiRequest, res: NextApiResponse) => {
  try {
    const {
      newAdmin,
      proposer,
      realmPk: MULTISIG_REALM,
    } = AddAdminSchema.parse(req.body);

    const { community } = req.query;
    const walletInfo = await getGasTank(community as string);
    const gasTank: Keypair = Keypair.fromSecretKey(
      bs58.decode(walletInfo.gasTankSecretKey)
    );

    // TODO: hardcoding version as 2 for now
    // const programVersion = await getGovernanceProgramVersion(
    //   connection,
    //   TEST_PROGRAM_ID
    // );
    const infoOrError = await getRealmInfo(MULTISIG_REALM, proposer);
    if (infoOrError.err) {
      return res.status(400).json({ error: infoOrError.val.message });
    }

    const {
      COUNCIL_MINT,
      COUNCIL_MINT_GOVERNANCE,
      multisigAdmin,
      proposalCount,
      tokenOwnerRecordPk,
    } = infoOrError.val;

    const proposalInstructions: TransactionInstruction[] = [];
    const insertInstructions: TransactionInstruction[] = [];

    const proposalAddress = await withCreateProposal(
      proposalInstructions,
      TEST_PROGRAM_ID,
      2,
      MULTISIG_REALM,
      COUNCIL_MINT_GOVERNANCE,
      tokenOwnerRecordPk,
      `Add ${newAdmin.toBase58()} as a member of the multisig`,
      `Created a proposal to add ${newAdmin.toBase58()} as a member of the multisig`,
      COUNCIL_MINT!,
      proposer,
      proposalCount,
      VoteType.SINGLE_CHOICE,
      ["Approve"],
      true,
      gasTank.publicKey
    );

    const mintInstructions: TransactionInstruction[] = [];

    const ataPk = await withCreateAssociatedTokenAccount(
      mintInstructions,
      COUNCIL_MINT,
      newAdmin,
      multisigAdmin
    );

    await withMintTo(
      mintInstructions,
      COUNCIL_MINT,
      ataPk,
      COUNCIL_MINT_GOVERNANCE,
      1
    );

    await insertInstructionsAndSignOff(
      insertInstructions,
      mintInstructions,
      COUNCIL_MINT_GOVERNANCE,
      MULTISIG_REALM,
      proposalAddress,
      tokenOwnerRecordPk,
      proposer,
      gasTank.publicKey
    );

    const serializedTxns = await getSerializedTxns(
      connection,
      proposalInstructions,
      insertInstructions,
      gasTank
    );

    return res.status(200).json({
      serializedTxns,
    });
  } catch (e) {
    console.log(e);
    return res.json({
      succes: false,
      error: e,
    });
  }
};

export default addPointsProposal;
