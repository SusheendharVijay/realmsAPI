import { getKeypair } from "../../../utils/general";
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

const AddAdminSchema = z.object({
  newAdmin: z.string(),
  proposer: z.string(),
});

type IWalletInfo = z.infer<typeof WalletInfoSchema>;

const addPointsProposal = async (req: NextApiRequest, res: NextApiResponse) => {
  try {
    const { newAdmin, proposer } = AddAdminSchema.parse(req.body);

    const { community } = req.query;
    const newAdminPk = new PublicKey(newAdmin);
    // const newAdminPk = Keypair.generate().publicKey;
    const proposerPk = new PublicKey(proposer);
    const LHT = getKeypair();
    const walletInfo = await getGasTank(community as string);
    const gasTank: Keypair = Keypair.fromSecretKey(
      bs58.decode(walletInfo.gasTankSecretKey)
    );

    const programVersion = await getGovernanceProgramVersion(
      connection,
      TEST_PROGRAM_ID
    );

    console.log("programVersion", programVersion);

    const tokenOwnerRecord = await getGovernanceAccounts(
      connection,
      TEST_PROGRAM_ID,
      TokenOwnerRecord,
      [pubkeyFilter(1, MULTISIG_REALM)!, pubkeyFilter(65, proposerPk)!]
    );

    const governance = await getGovernance(connection, COUNCIL_MINT_GOVERNANCE);

    const proposalInstructions: TransactionInstruction[] = [];
    const insertInstructions: TransactionInstruction[] = [];

    const treasuryAddr = await getNativeTreasuryAddress(
      TEST_PROGRAM_ID,
      COUNCIL_MINT_GOVERNANCE
    );

    const proposalAddress = await withCreateProposal(
      proposalInstructions,
      TEST_PROGRAM_ID,
      2,
      MULTISIG_REALM,
      COUNCIL_MINT_GOVERNANCE,
      tokenOwnerRecord[0]!.pubkey,
      // TODO: change to newAdmin later
      `Add ${newAdminPk.toBase58()} as a admin`,
      `Created a proposal to add ${newAdminPk.toBase58()} as a admin`,
      COUNCIL_MINT,
      proposerPk,
      governance.account.proposalCount,
      VoteType.SINGLE_CHOICE,
      ["Approve"],
      true,
      gasTank.publicKey
    );

    const input = JSON.stringify({
      adminAuthority: treasuryAddr,
      newAdmin: newAdminPk,
      daoWallet: treasuryAddr,
    });

    const apiUrl =
      "https://lighthouse-solana-1cotf8onr-lighthouse-dao.vercel.app/";

    const response = await fetch(
      `http://localhost:3000/api/${community}/addAdmin`,
      {
        method: "POST",
        body: input,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
    const instructions = InstructionSchema.parse(await response.json());
    console.log("instructions:", instructions);

    const parsedTxn = Transaction.from(instructions.serializedTxn);

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
        proposerPk,
        parsedTxn.instructions.indexOf(ins),
        0,
        0,
        [instructionData],
        gasTank.publicKey
      );
    }

    const signRecord = await withAddSignatory(
      proposalInstructions,
      TEST_PROGRAM_ID,
      programVersion,
      proposalAddress,
      tokenOwnerRecord[0]!.pubkey,
      proposerPk,
      proposerPk,
      gasTank.publicKey
    );

    const signatoryRecord = await getSignatoryRecordAddress(
      TEST_PROGRAM_ID,
      proposalAddress,
      proposerPk
    );
    // console.log("signatoryRecord", signatoryRecord);

    withSignOffProposal(
      insertInstructions,
      TEST_PROGRAM_ID,
      2,
      MULTISIG_REALM,
      COUNCIL_MINT_GOVERNANCE,
      proposalAddress,
      proposerPk,
      signatoryRecord,
      undefined
    );

    const txn1 = new Transaction().add(...proposalInstructions);
    const txn2 = new Transaction().add(...insertInstructions);

    console.log("txns: ", txn1, txn2);

    const blockHashObj = await connection.getLatestBlockhash();
    // TODO: use nonce account later
    txn1.recentBlockhash = blockHashObj.blockhash;
    txn2.recentBlockhash = blockHashObj.blockhash;

    txn1.feePayer = gasTank.publicKey;
    txn2.feePayer = gasTank.publicKey;

    txn1.partialSign(gasTank);
    txn2.partialSign(gasTank);

    // txn1.partialSign(LHT);
    // txn2.partialSign(LHT);

    // const ins = txn.instructions.map(i => )

    // const sig1 = await sendAndConfirmRawTransaction(
    //   connection,
    //   txn1.serialize({
    //     requireAllSignatures: true,
    //     verifySignatures: true,
    //   })
    // );
    // const sig2 = await sendAndConfirmRawTransaction(
    //   connection,
    //   txn2.serialize({
    //     requireAllSignatures: true,
    //     verifySignatures: true,
    //   })
    // );
    // console.log(sig1, sig2);

    const config = {
      requireAllSignatures: false,
      verifySignatures: true,
    };
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

const getGasTank = async (community: string): Promise<IWalletInfo> => {
  const res = await fetch(
    `http://localhost:3000/api/${community}/info?key=${process.env.API_KEY}`
  );

  const info = WalletInfoSchema.parse(await res.json());
  return info;
};

export default addPointsProposal;
