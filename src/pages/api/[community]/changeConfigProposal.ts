import { getGasTank } from "../../../utils/general";
import { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import bs58 from "bs58";

import {
  withCreateProposal,
  VoteType,
  GovernanceConfig,
  createSetGovernanceConfig,
  VoteThresholdPercentage,
} from "@solana/spl-governance";
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
const ChangeConfigSchema = z.object({
  proposer: z.string().transform((v) => new PublicKey(v)),
  realmPk: z.string().transform((v) => new PublicKey(v)),
  newYesVotePercentage: z.number().gt(0).lt(100),
});

const changeConfigProposal = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  try {
    const {
      newYesVotePercentage,
      proposer,
      realmPk: MULTISIG_REALM,
    } = ChangeConfigSchema.parse(req.body);

    const { community } = req.query;

    const walletInfo = await getGasTank(community as string);
    const gasTank: Keypair = Keypair.fromSecretKey(
      bs58.decode(walletInfo.gasTankSecretKey)
    );

    const realmInfo = await getRealmInfo(MULTISIG_REALM, proposer);
    if (realmInfo.err) {
      return res.status(400).json({ error: realmInfo.val.message });
    }
    const {
      COUNCIL_MINT,
      COUNCIL_MINT_GOVERNANCE,
      proposalCount,
      tokenOwnerRecordPk,
      governance,
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
      `Change governance config`,
      `Change required yes vote percentage to ${newYesVotePercentage}%`,
      COUNCIL_MINT!,
      proposer,
      proposalCount,
      VoteType.SINGLE_CHOICE,
      ["Approve"],
      true,
      gasTank.publicKey
    );

    const newConfig = new GovernanceConfig({
      ...governance.account.config,
      voteThresholdPercentage: new VoteThresholdPercentage({
        value: newYesVotePercentage,
      }),
    });

    const instruction = createSetGovernanceConfig(
      TEST_PROGRAM_ID,
      COUNCIL_MINT_GOVERNANCE,
      newConfig
    );

    await insertInstructionsAndSignOff(
      insertInstructions,
      [instruction],
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
    });
  }
};

export default changeConfigProposal;
