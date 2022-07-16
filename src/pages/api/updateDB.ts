// src/pages/api/grape.ts
import type { NextApiRequest, NextApiResponse } from "next";
import fs from "fs";
import { prisma } from "../../server/db/client";
import { z, ZodError } from "zod";
import {
  getGovernanceAccounts,
  TokenOwnerRecord,
  pubkeyFilter,
  getVoteRecordsByVoter,
  getProposal,
  ProgramAccount,
  VoteRecord,
  Proposal,
  getProposalsByGovernance,
  getRealm,
  getAllGovernances,
  GovernanceAccountType,
  YesNoVote,
  ProposalState,
  Governance,
} from "@solana/spl-governance";

import { performance } from "perf_hooks";
import { PublicKey, Connection } from "@solana/web3.js";
import {
  Prisma,
  Vote,
  VoteRecordVersion,
  ProposalStatus,
} from "@prisma/client";

const RequestObject = z.object({
  realmKeys: z.array(z.string().length(44).or(z.string().length(43))),
});

type Request = z.infer<typeof RequestObject>;

// const connection = new Connection("https://rpc.ankr.com/solana", "recent");
const connection = new Connection(
  process.env.QUICKNODE_RPC as string,
  "recent"
);

const updateDB = async (req: NextApiRequest, res: NextApiResponse) => {
  try {
    const { realmKeys } = RequestObject.parse(req.body);

    if (realmKeys.length === 0) {
      console.log("Updating all");
      await updateAll();
    }

    await updateRealms(realmKeys!);

    return res.status(200).json({ success: true });
  } catch (e) {
    if (e instanceof ZodError) {
      console.log(e.flatten());
      return res.status(400).json({ success: false });
    }
    console.log(e);

    return res.status(200).json({ success: false });
  }

  async function updateAll() {
    const realmKeysData = await prisma.realmLatestTimeStamp.findMany({
      select: {
        realmPubKey: true,
      },
      where: {
        subscribed: true,
      },
    });

    console.log("realmKeysData", realmKeysData);

    const realmKeys = realmKeysData.map((r) => r.realmPubKey);

    await updateRealms(realmKeys);
  }

  async function updateRealm(realmKey: PublicKey) {
    // Get all governances for the realm------------------------------------
    const realm = await getRealm(connection, realmKey);

    const realmOwner = realm.owner;

    const allGovernancesRaw = await getAllGovernances(
      connection,
      realmOwner,
      realmKey
    );

    console.log("Got all governances for the realm ✅");
    // filter out gov's without proposals-------------------------------------
    const governanceWithProposals = allGovernancesRaw.filter(
      (govern) => govern.account.proposalCount > 0
    );

    console.log("Filtered empty governances ✅");
    console.log(`Found ${governanceWithProposals.length} governance accounts`);

    // Get all the proposals for each governance-----------------------------------
    const realmProposals = await getAllProposals(
      governanceWithProposals,
      realmOwner
    );

    console.log("Got all proposals for each governance ✅");
    const newProposals = await getNewProposals(realmProposals, realmKey);

    await storeNewProposals(newProposals, realmKey);
    console.log("Got new proposals ✅");

    console.log("Filtered out old proposals ✅");

    if (newProposals.length === 0) {
      console.log("No new proposals, db up to date");
      return;
    }

    const latestTimeStamp = newProposals.reduce(
      (latest: number, proposal: ProgramAccount<Proposal>) =>
        proposal.account.draftAt.toNumber() > latest
          ? proposal.account.draftAt.toNumber()
          : latest,
      0
    );

    console.log("latest", latestTimeStamp);

    // Get all the vote records for each proposal---------------------------------
    const realmVoteRecords = await getAndStoreVoteRecords(
      realmProposals,
      realmOwner,
      realmKey
    );

    await prisma.realmLatestTimeStamp.upsert({
      where: {
        realmPubKey: realmKey.toBase58(),
      },
      update: {
        latestTimeStamp: latestTimeStamp,
      },
      create: {
        realmPubKey: realmKey.toBase58(),
        latestTimeStamp: latestTimeStamp,
        subscribed: true,
      },
    });

    console.log(`Stored ${realmVoteRecords.length} records in the database ✅`);
  }
  async function updateRealms(realmKeys: string[]) {
    const updateRealmPromises: Promise<void>[] = [];

    for (const realmKey of realmKeys) {
      updateRealmPromises.push(updateRealm(new PublicKey(realmKey)));
    }

    await Promise.all(updateRealmPromises);
  }

  async function getAllProposals(
    governanceWithProposals: ProgramAccount<Governance>[],
    realmOwner: PublicKey
  ): Promise<ProgramAccount<Proposal>[]> {
    let start = performance.now();
    const allProposalPromises: Promise<ProgramAccount<Proposal>[]>[] = [];
    for (let govern of governanceWithProposals) {
      const proposals = getProposalsByGovernance(
        connection,
        realmOwner,
        govern.pubkey
      );

      allProposalPromises.push(proposals);
    }
    const allProposals = await Promise.all(allProposalPromises);
    // console.log("all props", allProposals);
    const realmProposalsRaw = allProposals.reduce((acc, curr) =>
      acc.concat(curr)
    );
    // Filtering out proposals that aren't done with voting ---------------------------------------
    const realmProposals = realmProposalsRaw.filter(
      (prop) =>
        prop.account.state !== ProposalState.Voting &&
        prop.account.state !== ProposalState.Cancelled &&
        prop.account.state !== ProposalState.Draft &&
        prop.account.state !== ProposalState.SigningOff
    );

    console.log(`Got ${realmProposals.length} proposals ✅`);
    let end = performance.now();

    console.log(`Got all proposals in ${(end - start) / 1000}secs ✅`);

    return realmProposals;
  }
  async function getAndStoreVoteRecords(
    realmProposals: ProgramAccount<Proposal>[],
    realmOwner: PublicKey,
    realmKey: PublicKey
  ): Promise<ProgramAccount<VoteRecord>[]> {
    // TODO: filter out the proposals that have no votes

    let start = performance.now();
    const proposalToCreateTime = new Map<string, number>();
    const allVoteRecordsPromises: Promise<ProgramAccount<VoteRecord>[]>[] = [];
    for (let proposal of realmProposals) {
      proposalToCreateTime.set(
        proposal.pubkey.toBase58(),
        proposal.account.draftAt.toNumber()
      );
      const voteRecords = getGovernanceAccounts(
        connection,
        realmOwner,
        VoteRecord,
        [pubkeyFilter(1, proposal.pubkey)!]
      );
      allVoteRecordsPromises.push(voteRecords);
    }

    const allVoteRecords = await Promise.all(allVoteRecordsPromises);
    const realmVoteRecords = allVoteRecords.reduce((acc, curr) =>
      acc.concat(curr)
    );

    // Store the data in the database
    let realmVoteData: Prisma.VoteRecordCreateInput[];
    realmVoteData = realmVoteRecords.map((record) =>
      prepareVoteRecord(record, proposalToCreateTime, realmKey)
    );

    await prisma.voteRecord.createMany({
      data: realmVoteData,
    });

    let end = performance.now();

    console.log(`Got all vote records in fast ${(end - start) / 1000}secs ✅`);

    return realmVoteRecords;
  }

  async function getNewProposals(
    realmProposals: ProgramAccount<Proposal>[],
    realmKey: PublicKey
  ): Promise<ProgramAccount<Proposal>[]> {
    const prevTimestampRaw = await prisma.realmLatestTimeStamp.findUnique({
      where: {
        realmPubKey: realmKey.toBase58(),
      },
      select: {
        latestTimeStamp: true,
      },
    });
    const prevTimestamp = prevTimestampRaw
      ? Number(prevTimestampRaw.latestTimeStamp)
      : 0;
    console.log("db time", prevTimestamp);
    const newProposals = realmProposals.filter(
      (prop) => prop.account.draftAt.toNumber() > prevTimestamp
    );

    return newProposals;
  }

  async function storeNewProposals(
    newProposals: ProgramAccount<Proposal>[],
    realmKey: PublicKey
  ) {
    let proposalData: Prisma.ProposalCreateInput[];
    proposalData = newProposals.map((proposal) =>
      prepareProposals(proposal, realmKey)
    );

    await prisma.proposal.createMany({
      data: proposalData,
    });
  }

  function prepareProposals(
    proposal: ProgramAccount<Proposal>,
    realmKey: PublicKey
  ): Prisma.ProposalCreateInput {
    let state: ProposalStatus;

    if (proposal.account.state === ProposalState.Succeeded) {
      state = "Succeeded";
    } else if (proposal.account.state === ProposalState.Defeated) {
      state = "Defeated";
    } else if (proposal.account.state === ProposalState.Executing) {
      state = "Executing";
    } else if (proposal.account.state === ProposalState.ExecutingWithErrors) {
      state = "ExecutingWithErrors";
    } else if (proposal.account.state === ProposalState.Completed) {
      state = "Completed";
    } else {
      state = "Unknown";
    }

    return {
      pubKey: proposal.pubkey.toBase58(),
      createdAt: proposal.account.draftAt.toNumber(),
      state,
      name: proposal.account.name,
      descriptionLink: proposal.account.descriptionLink,
      createdBy: proposal.account.tokenOwnerRecord.toBase58(),
      governancePubKey: proposal.account.governance.toBase58(),
      realmPubKey: realmKey.toBase58(),
    };
  }

  function prepareVoteRecord(
    voteRecord: ProgramAccount<VoteRecord>,
    proposalToCreateTime: Map<string, number>,
    realmKey: PublicKey
  ): Prisma.VoteRecordCreateInput {
    let vote: Vote;
    let voteWeight: number;
    let version: VoteRecordVersion;

    if (voteRecord.account.accountType === GovernanceAccountType.VoteRecordV1) {
      version = "V1";
      vote = voteRecord.account.voteWeight?.yes ? Vote.Yes : Vote.No;
    } else {
      version = "V2";
      vote =
        voteRecord.account.vote?.toYesNoVote() === YesNoVote.Yes
          ? Vote.Yes
          : Vote.No;
    }

    voteWeight =
      vote === Vote.Yes
        ? (voteRecord.account.getYesVoteWeight()?.toNumber() as number)
        : (voteRecord.account.getNoVoteWeight()?.toNumber() as number);

    return {
      realmPubKey: realmKey.toBase58(),
      memberPubKey: voteRecord.account.governingTokenOwner.toBase58(),
      proposalPubkey: voteRecord.account.proposal.toBase58(),
      vote,
      voteWeight,
      version,
      proposalCreatedAt: proposalToCreateTime.get(
        voteRecord.account.proposal.toBase58()
      )!,
    };
  }
};

export default updateDB;
