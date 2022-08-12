import {
  getKeypair,
  getGasTank,
  getDevnetConnection,
} from "../../../utils/general";
import { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import bs58 from "bs58";

import {
  withCreateProposal,
  getGovernanceProgramVersion,
  TokenOwnerRecord,
  getGovernanceAccounts,
  pubkeyFilter,
  VoteType,
  withInsertTransaction,
  getGovernance,
  withAddSignatory,
  withSignOffProposal,
  getSignatoryRecordAddress,
  createInstructionData,
  getNativeTreasuryAddress,
  getRealm,
  GovernanceAccount,
  getAllGovernances,
  Governance,
  getGovernanceAccount,
} from "@solana/spl-governance";
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  Keypair,
  sendAndConfirmRawTransaction,
} from "@solana/web3.js";
import {
  getRealmInfo,
  getSerializedTxns,
  insertInstructionsAndSignOff,
} from "../../../utils/realmUtils";

const TEST_PROGRAM_ID = new PublicKey(
  "GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw"
);

// const MULTISIG_REALM = new PublicKey(
//   "Bcu1boQ1RBxRPQvAdQtyacGFmJ76Yq9iu1MkW6JnwuS4"
// );

// const COUNCIL_MINT = new PublicKey(
//   "2Gc6KVGvJT8g3chxWLMCgdqNEt4Z1gdfNkZTQp5dRpoo"
// );

// const COUNCIL_MINT_GOVERNANCE = new PublicKey(
//   "2mXqwYpN4fRPopEjyow8RRvQFMD7QwWTW3pxvZwjgaR6"
// );

const connection = getDevnetConnection();

const InstructionSchema = z.object({
  serializedTxn: z.array(z.number()),
});

const pubkeySchema = z.string().transform((v) => new PublicKey(v));

const AddAdminSchema = z.object({
  newAdmin: pubkeySchema,
  proposer: pubkeySchema,
  multisigRealm: pubkeySchema,
});

const addPointsProposal = async (req: NextApiRequest, res: NextApiResponse) => {
  try {
    const {
      newAdmin,
      proposer,
      multisigRealm: MULTISIG_REALM,
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
    const {
      COUNCIL_MINT,
      COUNCIL_MINT_GOVERNANCE,
      multisigAdmin,
      proposalCount,
      tokenOwnerRecordPk,
    } = await getRealmInfo(MULTISIG_REALM, proposer);

    const proposalInstructions: TransactionInstruction[] = [];
    const insertInstructions: TransactionInstruction[] = [];

    const proposalAddress = await withCreateProposal(
      proposalInstructions,
      TEST_PROGRAM_ID,
      2,
      MULTISIG_REALM,
      COUNCIL_MINT_GOVERNANCE,
      tokenOwnerRecordPk,
      `Add ${newAdmin.toBase58()} as a admin`,
      `Created a proposal to add ${newAdmin.toBase58()} as a admin`,
      COUNCIL_MINT!,
      proposer,
      proposalCount,
      VoteType.SINGLE_CHOICE,
      ["Approve"],
      true,
      gasTank.publicKey
    );

    const input = JSON.stringify({
      adminAuthority: multisigAdmin,
      newAdmin: newAdmin,
      daoWallet: multisigAdmin,
    });

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

    const parsedTxn = Transaction.from(instructions.serializedTxn);

    await insertInstructionsAndSignOff(
      insertInstructions,
      parsedTxn,
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
