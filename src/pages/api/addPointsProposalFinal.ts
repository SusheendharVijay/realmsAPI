import { getKeypair } from "../../utils/general";
import { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";

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
} from "@solana/spl-governance";
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  sendAndConfirmRawTransaction,
} from "@solana/web3.js";

import {
  createAssociatedTokenAccount,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
  getAccount,
  mintTo,
} from "@solana/spl-token";
import { getDevnetConnection } from "../../utils/general";

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

const DAO_WALLET = new PublicKey(
  "2rAaREc7BE753sXUW6bd9vbn1NsLEz8VZraZTTv4WeeB"
);

const TEST_MINT = new PublicKey("GqvxqxFVUAVbujnTyzvwrLDijJQ5oMTb8KU3AizQrSLs");

const dave = new PublicKey("4rpZQJHMz5UNWQEutZcLJi7hGaZgV3vnFoS1EqZFJRi2");

const connection = getDevnetConnection();

const InstructionSchema = z.object({
  serializedTxn: z.array(z.number()),
});

const AddPointsSchema = z.object({
  receiver: z.string(),
  amount: z.number(),
});

const addPointsProposal = async (req: NextApiRequest, res: NextApiResponse) => {
  const { receiver, amount } = AddPointsSchema.parse(req.body);

  try {
    const LHT = getKeypair();
    const programVersion = await getGovernanceProgramVersion(
      connection,
      TEST_PROGRAM_ID
    );

    console.log("programVersion", programVersion);

    const tokenOwnerRecord = await getGovernanceAccounts(
      connection,
      TEST_PROGRAM_ID,
      TokenOwnerRecord,
      [pubkeyFilter(1, MULTISIG_REALM)!, pubkeyFilter(65, LHT.publicKey)!]
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
      `Add ${amount} points to ${receiver}, proposal-index: ${governance.account.proposalCount}`,
      `Created a proposal to add points to a user, user: ${receiver}, amount: ${amount}`,
      COUNCIL_MINT,
      LHT.publicKey,
      governance.account.proposalCount,
      VoteType.SINGLE_CHOICE,
      ["Approve"],
      true,
      LHT.publicKey
    );

    // let associatedTokenAccount = await getAssociatedTokenAddress(
    //   TEST_MINT,
    //   LHT.publicKey
    // );

    // console.log(associatedTokenAccount);

    // const insertInstructions: TransactionInstruction[] = [];

    // try {
    //   const info = await getAccount(connection, associatedTokenAccount);
    //   console.log(info);
    // } catch (e) {
    //   insertInstructions.push(
    //     createAssociatedTokenAccountInstruction(
    //       DAO_WALLET,
    //       associatedTokenAccount,
    //       LHT.publicKey,
    //       TEST_MINT
    //     )
    //   );
    // }

    // insertInstructions.push(
    //   createMintToInstruction(
    //     TEST_MINT,
    //     associatedTokenAccount,
    //     COUNCIL_MINT_GOVERNANCE,
    //     LAMPORTS_PER_SOL * 1
    //   )
    // );

    const input = JSON.stringify({
      admin: COUNCIL_MINT_GOVERNANCE,
      receiver: receiver,
      amount: amount,
    });

    const apiUrl =
      "https://lighthouse-solana-m6rddbtpx-lighthouse-dao.vercel.app";
    const response = await fetch(`${apiUrl}/api/PartialSign-2/addPoints`, {
      method: "POST",
      body: input,
      headers: {
        "Content-Type": "application/json",
      },
    });
    const instructions = InstructionSchema.parse(await response.json());
    // console.log(instructions);

    const parsedTxn = Transaction.from(instructions.serializedTxn);
    // console.log(parsedTxn.instructions);

    // for (let txn of parsedTxn.instructions) {
    //   console.log(txn);
    // }

    for (let ins of parsedTxn.instructions) {
      const instructionData = createInstructionData(ins);

      const signers = instructionData.accounts
        .filter((acc) => acc.isSigner)
        .map((acc) => acc.pubkey.toBase58());

      console.log("Signers", signers);

      await withInsertTransaction(
        insertInstructions,
        TEST_PROGRAM_ID,
        2,
        COUNCIL_MINT_GOVERNANCE,
        proposalAddress,
        tokenOwnerRecord[0]!.pubkey,
        LHT.publicKey,
        parsedTxn.instructions.indexOf(ins),
        0,
        0,
        [instructionData],
        LHT.publicKey
      );
    }

    const signRecord = await withAddSignatory(
      proposalInstructions,
      TEST_PROGRAM_ID,
      programVersion,
      proposalAddress,
      tokenOwnerRecord[0]!.pubkey,
      LHT.publicKey,
      LHT.publicKey,
      LHT.publicKey
    );

    const signatoryRecord = await getSignatoryRecordAddress(
      TEST_PROGRAM_ID,
      proposalAddress,
      LHT.publicKey
    );
    // console.log("signatoryRecord", signatoryRecord);

    withSignOffProposal(
      insertInstructions,
      TEST_PROGRAM_ID,
      2,
      MULTISIG_REALM,
      COUNCIL_MINT_GOVERNANCE,
      proposalAddress,
      LHT.publicKey,
      signatoryRecord,
      undefined
    );

    const txn1 = new Transaction().add(...proposalInstructions);
    const txn2 = new Transaction().add(...insertInstructions);

    // const blockHashObj = await connection.getLatestBlockhash();
    // txn.recentBlockhash = blockHashObj.blockhash;

    // txn.feePayer = LHT.publicKey;

    // const ins = txn.instructions.map(i => )

    // const sig = await sendAndConfirmRawTransaction(
    //   connection,
    //   txn.serialize({
    //     requireAllSignatures: false,
    //     verifySignatures: true,
    //   })
    // );

    const sig1 = await sendAndConfirmTransaction(connection, txn1, [LHT]);
    const sig2 = await sendAndConfirmTransaction(connection, txn2, [LHT]);
    console.log(sig1, sig2);

    //   const sig = "";
    return res.status(200).json({
      succes: true,
      //   result: instructions,
    });
  } catch (e) {
    console.log(e);
    return res.json({
      succes: false,
    });
  }
};

export default addPointsProposal;
