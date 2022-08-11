import { getKeypair, getGasTank } from "../../../utils/general";
import { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import bs58 from "bs58";
import { WalletInfoSchema } from "../../../../lib/types";

import {
  withCreateProposal,
  getGovernanceProgramVersion,
  TokenOwnerRecord,
  getGovernanceAccounts,
  pubkeyFilter,
  VoteType,
  CreateProposalArgs,
  withInsertTransaction,
  getGovernance,
  withAddSignatory,
  withExecuteTransaction,
  withSignOffProposal,
  getSignatoryRecordAddress,
  serializeInstructionToBase64,
  InstructionData,
  createInstructionData,
  withCastVote,
  getNativeTreasuryAddress,
} from "@solana/spl-governance";
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  Keypair,
  sendAndConfirmRawTransaction,
} from "@solana/web3.js";

import { getDevnetConnection } from "../../../utils/general";
import { Wallet } from "@project-serum/anchor";

const TEST_PROGRAM_ID = new PublicKey(
  "GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw"
);

const MULTISIG_REALM = new PublicKey(
  "Bcu1boQ1RBxRPQvAdQtyacGFmJ76Yq9iu1MkW6JnwuS4"
);

const COUNCIL_MINT = new PublicKey(
  "2Gc6KVGvJT8g3chxWLMCgdqNEt4Z1gdfNkZTQp5dRpoo"
);

const COUNCIL_MINT_GOVERNANCE = new PublicKey(
  "2mXqwYpN4fRPopEjyow8RRvQFMD7QwWTW3pxvZwjgaR6"
);

const TEST_MINT = new PublicKey("GqvxqxFVUAVbujnTyzvwrLDijJQ5oMTb8KU3AizQrSLs");

const dave = new PublicKey("4rpZQJHMz5UNWQEutZcLJi7hGaZgV3vnFoS1EqZFJRi2");
const carol = new PublicKey("B6nau95gSNCtxMpZEYRNXScvszX7tDZkvkMNXXmwF6Q1");
const connection = getDevnetConnection();

const InstructionSchema = z.object({
  serializedTxn: z.array(z.number()),
});
const AddLogSchema = z.object({
  receiver: z.string().transform((v) => new PublicKey(v)),
  multisigAdmin: z.string().transform((v) => new PublicKey(v)),
  amount: z.number(),
  reason: z.string(),
  tags: z.string(),
  pointsBreakdown: z.string(),
  proposer: z.string().transform((v) => new PublicKey(v)),
});

const addLogProposal = async (req: NextApiRequest, res: NextApiResponse) => {
  try {
    const {
      receiver,
      amount,
      reason,
      tags,
      pointsBreakdown,
      proposer,
      multisigAdmin,
    } = AddLogSchema.parse(req.body);

    const { community } = req.query;
    const walletInfo = await getGasTank(community as string);
    const gasTank: Keypair = Keypair.fromSecretKey(
      bs58.decode(walletInfo.gasTankSecretKey)
    );

    const programVersion = await getGovernanceProgramVersion(
      connection,
      TEST_PROGRAM_ID
    );

    const tokenOwnerRecord = await getGovernanceAccounts(
      connection,
      TEST_PROGRAM_ID,
      TokenOwnerRecord,
      [pubkeyFilter(1, MULTISIG_REALM)!, pubkeyFilter(65, proposer)!]
    );

    const governance = await getGovernance(connection, COUNCIL_MINT_GOVERNANCE);

    const proposalInstructions: TransactionInstruction[] = [];
    const insertInstructions: TransactionInstruction[] = [];

    const proposalAddress = await withCreateProposal(
      proposalInstructions,
      TEST_PROGRAM_ID,
      2,
      MULTISIG_REALM,
      COUNCIL_MINT_GOVERNANCE,
      tokenOwnerRecord[0]!.pubkey,
      `Add an attestation for ${receiver}`,
      `Reason: ${reason}, amount: ${amount} Tags: ${tags}, Points Breakdown: ${pointsBreakdown}`,
      COUNCIL_MINT,
      proposer,
      governance.account.proposalCount,
      VoteType.SINGLE_CHOICE,
      ["Approve"],
      true,
      gasTank.publicKey
    );

    const input = JSON.stringify({
      receiver: receiver.toBase58(),
      admin: multisigAdmin.toBase58(),
      amount: amount,
      reason: reason,
      tags: tags,
      pointsBreakdown: pointsBreakdown,
      daoWallet: multisigAdmin.toBase58(),
    });

    const response = await fetch(
      `http://localhost:3000/api/${community}/addLog`,
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

    for (let ins of parsedTxn.instructions) {
      const instructionData = createInstructionData(ins);

      await withInsertTransaction(
        insertInstructions,
        TEST_PROGRAM_ID,
        2,
        COUNCIL_MINT_GOVERNANCE,
        proposalAddress,
        tokenOwnerRecord[0]!.pubkey,
        proposer,
        parsedTxn.instructions.indexOf(ins),
        0,
        0,
        [instructionData],
        gasTank.publicKey
      );
    }

    await withAddSignatory(
      proposalInstructions,
      TEST_PROGRAM_ID,
      programVersion,
      proposalAddress,
      tokenOwnerRecord[0]!.pubkey,
      proposer,
      proposer,
      gasTank.publicKey
    );

    const signatoryRecord = await getSignatoryRecordAddress(
      TEST_PROGRAM_ID,
      proposalAddress,
      proposer
    );

    withSignOffProposal(
      insertInstructions,
      TEST_PROGRAM_ID,
      2,
      MULTISIG_REALM,
      COUNCIL_MINT_GOVERNANCE,
      proposalAddress,
      proposer,
      signatoryRecord,
      undefined
    );

    // Splitting them into 2 txn since it exceeds max size sometimes. Precautionary measure at this point.
    const txn1 = new Transaction().add(...proposalInstructions);
    const txn2 = new Transaction().add(...insertInstructions);

    const blockHashObj = await connection.getLatestBlockhash();
    // TODO: use nonce account later
    txn1.recentBlockhash = blockHashObj.blockhash;
    txn2.recentBlockhash = blockHashObj.blockhash;

    txn1.feePayer = gasTank.publicKey;
    txn2.feePayer = gasTank.publicKey;

    txn1.partialSign(gasTank);
    txn2.partialSign(gasTank);

    const config = {
      requireAllSignatures: false,
      verifySignatures: true,
    };

    // const sig1 = await sendAndConfirmRawTransaction(
    //   connection,
    //   txn1.serialize(config)
    // );
    // const sig2 = await sendAndConfirmRawTransaction(
    //   connection,
    //   txn2.serialize(config)
    // );
    // console.log(sig1, sig2);
    return res.status(200).json({
      serializedTxns: [txn1.serialize(config), txn2.serialize(config)],
    });
  } catch (e) {
    console.log(e);
    return res.json({
      succes: false,
    });
  }
};

export default addLogProposal;
