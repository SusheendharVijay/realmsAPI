import {
  createInstructionData,
  getGovernanceAccounts,
  getNativeTreasuryAddress,
  getRealm,
  getSignatoryRecordAddress,
  Governance,
  pubkeyFilter,
  TokenOwnerRecord,
  withInsertTransaction,
  withSignOffProposal,
} from "@solana/spl-governance";
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmRawTransaction,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { getDevnetConnection, getKeypair } from "./general";

const TEST_PROGRAM_ID = new PublicKey(
  "GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw"
);

export const getRealmInfo = async (realmPk: PublicKey, proposer: PublicKey) => {
  const connection = getDevnetConnection();
  const realmInfo = await getRealm(connection, realmPk);
  // get realm, get council mint, using that get governance account then get treasury wallet.
  const COUNCIL_MINT = realmInfo.account.config.councilMint;
  const governanceInfo = await getGovernanceAccounts(
    connection,
    TEST_PROGRAM_ID,
    Governance,
    [pubkeyFilter(33, COUNCIL_MINT)!]
  );
  const governance = governanceInfo[0]!;

  const COUNCIL_MINT_GOVERNANCE = governance.pubkey;

  const multisigAdmin = await getNativeTreasuryAddress(
    TEST_PROGRAM_ID,
    COUNCIL_MINT_GOVERNANCE
  );
  const tokenOwnerRecord = await getGovernanceAccounts(
    connection,
    TEST_PROGRAM_ID,
    TokenOwnerRecord,
    [pubkeyFilter(1, realmPk)!, pubkeyFilter(65, proposer)!]
  );

  return {
    COUNCIL_MINT,
    COUNCIL_MINT_GOVERNANCE,
    multisigAdmin,
    proposalCount: governance.account.proposalCount,
    tokenOwnerRecordPk: tokenOwnerRecord[0]!.pubkey,
  };
};

export const insertInstructionsAndSignOff = async (
  insertInstructions: TransactionInstruction[],
  parsedTxn: Transaction,
  COUNCIL_MINT_GOVERNANCE: PublicKey,
  MULTISIG_REALM: PublicKey,
  proposalAddress: PublicKey,
  tokenOwnerRecordPk: PublicKey,
  proposer: PublicKey,
  gasTankPk: PublicKey
) => {
  for (let ins of parsedTxn.instructions) {
    const instructionData = createInstructionData(ins);

    await withInsertTransaction(
      insertInstructions,
      TEST_PROGRAM_ID,
      2,
      COUNCIL_MINT_GOVERNANCE,
      proposalAddress,
      tokenOwnerRecordPk,
      proposer,
      parsedTxn.instructions.indexOf(ins),
      0,
      0,
      [instructionData],
      gasTankPk
    );
  }
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
    undefined,
    // signatoryRecord,
    tokenOwnerRecordPk
  );
};

export const getSerializedTxns = async (
  connection: Connection,
  proposalInstructions: TransactionInstruction[],
  insertInstructions: TransactionInstruction[],
  gasTank: Keypair
) => {
  const LHT = getKeypair();
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

  //   txn1.partialSign(LHT);
  //   txn2.partialSign(LHT);

  //   const sig1 = await sendAndConfirmRawTransaction(
  //     connection,
  //     txn1.serialize(config)
  //   );
  //   const sig2 = await sendAndConfirmRawTransaction(
  //     connection,
  //     txn2.serialize(config)
  //   );
  //   console.log(sig1, sig2);

  return [txn1.serialize(config), txn2.serialize(config)];
};
