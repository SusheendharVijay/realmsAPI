import { getKeypair } from "./../../utils/general";
import { NextApiRequest, NextApiResponse } from "next";

import {
  withCreateProposal,
  getGovernanceProgramVersion,
  TokenOwnerRecord,
  getGovernanceAccounts,
  pubkeyFilter,
  getTokenOwnerRecord,
  getTokenOwnerRecordForRealm,
  VoteType,
  CreateProposalArgs,
  withInsertTransaction,
} from "@solana/spl-governance";
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { getDevnetConnection } from "../../utils/general";

const TEST_PROGRAM_ID = new PublicKey(
  "GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw"
);

const MULTISIG_REALM = new PublicKey(
  "8qfaVFsZJvo15hBHP66NsXYrnY1qSucayXyvSSCQeUdR"
);

const COUNCIL_MINT = new PublicKey(
  "FfhSaA7fX2UdMegBN4xd5CBX7nXn1QXNLsytXFfqfKJR"
);

const COUNCIL_MINT_GOVERNANCE = new PublicKey(
  "EVJqJx3XYpKeugoW1cD4ae2AFEnvvveZHjSrDgxC5qbG"
);

const connection = getDevnetConnection();
const createProposal = async (req: NextApiRequest, res: NextApiResponse) => {
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

  console.log("tokenOwnerRecord", tokenOwnerRecord);
  //   const tokenOwnerRecord = await getTokenOwnerRecordForRealm(
  //     connection,
  //     TEST_PROGRAM_ID,
  //     MULTI_REALMSIG,
  //     new PublicKey("FfhSaA7fX2UdMegBN4xd5CBX7nXn1QXNLsytXFfqfKJR"),
  //     LHT
  //   );
  const proposalInstructions: TransactionInstruction[] = [];
  const pubkey = await withCreateProposal(
    proposalInstructions,
    TEST_PROGRAM_ID,
    programVersion,
    MULTISIG_REALM,
    COUNCIL_MINT_GOVERNANCE,
    tokenOwnerRecord[0]!.pubkey,
    "Test Proposal",
    "This is a test proposal",
    COUNCIL_MINT,
    LHT.publicKey,
    0,
    VoteType.SINGLE_CHOICE,
    ["Approve"],
    true,
    LHT.publicKey
  );

  const txn = new Transaction().add(...proposalInstructions);
  console.log(txn);

  const sig = await sendAndConfirmTransaction(connection, txn, [LHT, LHT]);

  //   const sig = "";
  return res.json({
    version: programVersion,
    result: sig,
    proposal: pubkey,
    ins: txn,
  });
};

export default createProposal;
