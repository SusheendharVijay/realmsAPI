import { getGasTank } from "../../../utils/general";
import { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import bs58 from "bs58";

import { withCreateProposal, VoteType } from "@solana/spl-governance";
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  Keypair,
} from "@solana/web3.js";

import { getDevnetConnection } from "../../../utils/general";
import {
  getRealmInfo,
  getSerializedTxns,
  insertInstructionsAndSignOff,
} from "../../../utils/realmUtils";

const TEST_PROGRAM_ID = new PublicKey(
  "GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw"
);

const connection = getDevnetConnection();

const InstructionSchema = z.object({
  serializedTxn: z.array(z.number()),
});
const AddLogSchema = z.object({
  receiver: z.string().transform((v) => new PublicKey(v)),
  realmPk: z.string().transform((v) => new PublicKey(v)),
  amount: z.number(),
  reason: z.string(),
  proposer: z.string().transform((v) => new PublicKey(v)),
});

const addPointsProposal = async (req: NextApiRequest, res: NextApiResponse) => {
  try {
    const {
      receiver,
      amount,
      proposer,
      realmPk: MULTISIG_REALM,
      reason,
    } = AddLogSchema.parse(req.body);

    const { community } = req.query;

    const walletInfo = await getGasTank(community as string);
    if (walletInfo.err) {
      return res.status(400).json({ error: walletInfo.val.message });
    }
    const gasTank: Keypair = Keypair.fromSecretKey(
      bs58.decode(walletInfo.val.gasTankSecretKey)
    );
    const realmInfo = await getRealmInfo(MULTISIG_REALM, proposer);
    if (realmInfo.err) {
      return res.status(400).json({ error: realmInfo.val.message });
    }
    const {
      COUNCIL_MINT,
      COUNCIL_MINT_GOVERNANCE,
      multisigAdmin,
      proposalCount,
      tokenOwnerRecordPk,
    } = realmInfo.val;

    const proposalInstructions: TransactionInstruction[] = [];
    const insertInstructions: TransactionInstruction[] = [];

    const proposalAddress = await withCreateProposal(
      proposalInstructions,
      TEST_PROGRAM_ID,
      2,
      MULTISIG_REALM,
      COUNCIL_MINT_GOVERNANCE,
      tokenOwnerRecordPk,
      `Add ${amount} points to ${receiver}`,
      `Reason: ${reason}`,
      COUNCIL_MINT!,
      proposer,
      proposalCount,
      VoteType.SINGLE_CHOICE,
      ["Approve"],
      true,
      gasTank.publicKey
    );

    const input = JSON.stringify({
      receiver: receiver.toBase58(),
      admin: multisigAdmin.toBase58(),
      amount: amount,
      daoWallet: multisigAdmin.toBase58(),
    });

    const response = await fetch(
      `https://lighthouse-solana-api.vercel.app/api/${community}/addPoints`,
      {
        method: "POST",
        body: input,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    const instructions = InstructionSchema.parse(await response.json());

    const parsedTxn = Transaction.from(instructions.serializedTxn);

    await insertInstructionsAndSignOff(
      insertInstructions,
      parsedTxn.instructions,
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
      proposalAddress,
    });
  } catch (e) {
    console.log(e);
    return res.json({
      succes: false,
    });
  }
};

export default addPointsProposal;
