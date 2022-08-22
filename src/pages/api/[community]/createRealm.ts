import { getKeypair } from "../../../utils/general";
import { getGasTank, getDevnetConnection } from "../../../utils/general";
import { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import bs58 from "bs58";

import {
  withCreateRealm,
  MintMaxVoteWeightSource,
  GovernanceConfig,
  VoteThresholdPercentage,
  VoteTipping,
  withCreateMintGovernance,
  withDepositGoverningTokens,
  getTokenOwnerRecordAddress,
  PROGRAM_VERSION_V2,
  withCreateNativeTreasury,
  withSetRealmAuthority,
  SetRealmAuthorityAction,
  getNativeTreasuryAddress,
} from "@solana/spl-governance";
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  Keypair,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  getMintNaturalAmountFromDecimalAsBN,
  withCreateAssociatedTokenAccount,
  withCreateMint,
  withMintTo,
  getTimestampFromDays,
} from "../../../utils/realmUtils";

import { MintLayout } from "@solana/spl-token";
import { BN } from "@project-serum/anchor";
import NextCors from "nextjs-cors";

const TEST_PROGRAM_ID = new PublicKey(
  "GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw"
);

const connection = getDevnetConnection();

const pubkeySchema = z.string().transform((v) => new PublicKey(v));

const CreateRealmSchema = z.object({
  yesVoteThreshold: z.number().gt(0).lt(100),
  councilMemberPks: z.array(pubkeySchema),
  walletPk: pubkeySchema,
});

const createRealm = async (req: NextApiRequest, res: NextApiResponse) => {
  await NextCors(req, res, {
    // Options
    methods: ["POST"],
    origin: "*",
    optionsSuccessStatus: 200, // some legacy browsers (IE11, various SmartTVs) choke on 204
  });
  try {
    const { walletPk, yesVoteThreshold, councilMemberPks } =
      CreateRealmSchema.parse(req.body);

    const { community: communityName } = req.query;

    const LHT = getKeypair();
    const walletInfo = await getGasTank(communityName as string);
    if (walletInfo.err) {
      return res.status(400).json({ error: walletInfo.val.message });
    }
    const gasTank: Keypair = Keypair.fromSecretKey(
      bs58.decode(walletInfo.val.gasTankSecretKey)
    );

    const mintsSetupInstructions: TransactionInstruction[] = [];
    const councilMembersInstructions: TransactionInstruction[] = [];

    const mintsSetupSigners: Keypair[] = [];

    // Default to 100% supply
    const communityMintMaxVoteWeightSource =
      MintMaxVoteWeightSource.FULL_SUPPLY_FRACTION;

    // The community mint is going to have 0 supply and we arbitrarily set it to 1m
    const minCommunityTokensToCreate = 1000_000;

    // Community mint decimals
    const communityMintDecimals = 6;

    const minimumRent = await connection.getMinimumBalanceForRentExemption(
      MintLayout.span
    );

    // Create community minkt
    const communityMintPk = await withCreateMint(
      connection,
      mintsSetupInstructions,
      mintsSetupSigners,
      walletPk,
      null,
      communityMintDecimals,
      gasTank.publicKey
    );
    // Create council mint
    const councilMintPk = await withCreateMint(
      connection,
      mintsSetupInstructions,
      mintsSetupSigners,
      walletPk,
      null,
      0,
      gasTank.publicKey
    );
    let walletAtaPk: PublicKey | undefined;
    const tokenAmount = 1;

    for (const teamWalletPk of councilMemberPks) {
      const ataPk = await withCreateAssociatedTokenAccount(
        councilMembersInstructions,
        councilMintPk,
        teamWalletPk,
        gasTank.publicKey
      );

      // Mint 1 council token to each team member
      await withMintTo(
        councilMembersInstructions,
        councilMintPk,
        ataPk,
        walletPk,
        tokenAmount
      );

      if (teamWalletPk.equals(walletPk)) {
        walletAtaPk = ataPk;
      }
    }

    // Create realm
    const realmInstructions: TransactionInstruction[] = [];

    // Convert to mint natural amount
    const minCommunityTokensToCreateAsMintValue =
      getMintNaturalAmountFromDecimalAsBN(
        minCommunityTokensToCreate,
        communityMintDecimals
      );
    const realmPk = await withCreateRealm(
      realmInstructions,
      TEST_PROGRAM_ID,
      PROGRAM_VERSION_V2,
      `${communityName}-multisig`,
      gasTank.publicKey,
      communityMintPk,
      gasTank.publicKey,
      councilMintPk,
      communityMintMaxVoteWeightSource,
      minCommunityTokensToCreateAsMintValue,
      undefined
    );

    let tokenOwnerRecordPk: PublicKey | null = null;

    // If the current wallet is in the team then deposit the council token
    if (walletAtaPk) {
      await withDepositGoverningTokens(
        realmInstructions,
        TEST_PROGRAM_ID,
        PROGRAM_VERSION_V2,
        realmPk,
        walletAtaPk,
        councilMintPk,
        walletPk,
        walletPk,
        gasTank.publicKey,
        new BN(tokenAmount)
      );

      tokenOwnerRecordPk = await getTokenOwnerRecordAddress(
        TEST_PROGRAM_ID,
        realmPk,
        councilMintPk,
        walletPk
      );
    } else {
      return res.status(401).json({
        success: false,
        error: "Current wallet must be a member of the realm",
      });
    }

    // Put community and council mints under the realm governance with default config
    const config = new GovernanceConfig({
      voteThresholdPercentage: new VoteThresholdPercentage({
        value: yesVoteThreshold,
      }),
      minCommunityTokensToCreateProposal: minCommunityTokensToCreateAsMintValue,
      // Do not use instruction hold up time
      minInstructionHoldUpTime: 0,
      // max voting time 3 days
      maxVotingTime: getTimestampFromDays(3),
      voteTipping: VoteTipping.Strict,
      proposalCoolOffTime: 0,
      minCouncilTokensToCreateProposal: new BN(1),
    });

    const communityMintGovPk = await withCreateMintGovernance(
      realmInstructions,
      TEST_PROGRAM_ID,
      PROGRAM_VERSION_V2,
      realmPk,
      communityMintPk,
      config,
      !!walletPk,
      walletPk,
      tokenOwnerRecordPk,
      gasTank.publicKey,
      walletPk
    );

    const councilMintGovPk = await withCreateMintGovernance(
      realmInstructions,
      TEST_PROGRAM_ID,
      PROGRAM_VERSION_V2,
      realmPk,
      councilMintPk,
      config,
      !!walletPk,
      walletPk,
      tokenOwnerRecordPk,
      gasTank.publicKey,
      walletPk
    );

    const daoWallet = await getNativeTreasuryAddress(
      TEST_PROGRAM_ID,
      councilMintGovPk
    );

    await withCreateNativeTreasury(
      realmInstructions,
      TEST_PROGRAM_ID,
      communityMintGovPk,
      gasTank.publicKey
    );
    // Set the community governance as the realm authority
    withSetRealmAuthority(
      realmInstructions,
      TEST_PROGRAM_ID,
      PROGRAM_VERSION_V2,
      realmPk,
      gasTank.publicKey,
      communityMintGovPk,
      SetRealmAuthorityAction.SetChecked
    );

    console.log("communityMintPk", communityMintPk.toBase58());
    console.log("councilMintPk", councilMintPk.toBase58());
    console.log("walletAtaPk", walletAtaPk?.toBase58());
    console.log("realmPk", realmPk.toBase58());
    console.log("communityMintGovPk", communityMintGovPk.toBase58());
    console.log("tokenOwnerRecordPk", tokenOwnerRecordPk?.toBase58());
    console.log("gasTank", gasTank.publicKey.toBase58());
    console.log("daoWallet", daoWallet.toBase58());
    // console.log("realmsigners", realmSigners);

    const txn1 = new Transaction();
    txn1.add(
      ...mintsSetupInstructions
      //   ...councilMembersInstructions
      //   ...realmInstructions
    );
    const txn2 = new Transaction();
    txn2.add(...councilMembersInstructions, ...realmInstructions);

    txn1.feePayer = gasTank.publicKey;
    txn2.feePayer = gasTank.publicKey;

    const blockHashObj = await connection.getLatestBlockhash();
    txn1.recentBlockhash = blockHashObj.blockhash;
    txn2.recentBlockhash = blockHashObj.blockhash;

    const hash1 = await sendAndConfirmTransaction(connection, txn1, [
      gasTank,
      ...mintsSetupSigners,
    ]);

    // const hash2 = await sendAndConfirmTransaction(connection, txn2, [
    //   gasTank,
    //   LHT,
    // ]);

    txn2.partialSign(gasTank);

    return res.status(200).json({
      serializedTxns: [
        txn2.serialize({
          requireAllSignatures: false,
          verifySignatures: true,
        }),
      ],
      realmPk: realmPk.toBase58(),
      councilMintGovPk: councilMintGovPk.toBase58(),
      daoWallet: daoWallet.toBase58(),
    });
  } catch (error) {
    console.log(error);
    return res.status(400).json({ success: false, error: error });
  }
};

export default createRealm;
