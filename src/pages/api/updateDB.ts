// src/pages/api/grape.ts
import type { NextApiRequest, NextApiResponse } from "next";
import fs from "fs";
import { prisma } from "../../server/db/client";
import { z } from "zod";
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
import { Prisma, Vote, VoteRecordVersion } from "@prisma/client";

const splProgramId = new PublicKey(
  "GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw"
);

const grapePubkey = new PublicKey(
  "By2sVGZXwfQq6rAiAM3rNPJ9iQfb5e2QhnF4YjJ4Bip"
);

const connection = new Connection("https://rpc.ankr.com/solana", "recent");

const updateDB = async (req: NextApiRequest, res: NextApiResponse) => {
  try {
    // const realm = await getRealm(connection, grapePubkey);

    // Get all governances for the realm------------------------------------
    const allGovernancesRaw = await getAllGovernances(
      connection,
      splProgramId,
      grapePubkey
    );

    console.log("Got all governances for the realm ✅");

    // filter out gov's without proposals-------------------------------------
    const governanceWithProposals = allGovernancesRaw.filter(
      (govern) => govern.account.proposalCount > 0
    );

    console.log("Filtered empty governances ✅");

    // Get all the proposals for each governance-----------------------------------
    const realmProposals = await getAllProposals(governanceWithProposals);

    const newProposals = await getNewProposals(realmProposals);

    console.log("Filtered out old proposals ✅");

    if (newProposals.length === 0) {
      console.log("No new proposals, db up to date");
      return res.status(200).json({ success: true });
    }

    const latestTimeStamp = newProposals.reduce(
      (latest: number, proposal: ProgramAccount<Proposal>) =>
        proposal.account.draftAt.toNumber() > latest
          ? proposal.account.draftAt.toNumber()
          : latest,
      0
    );

    console.log("latest", latestTimeStamp);

    // Get all the vote records for each proposal----------------------------------
    const realmVoteRecords = await getAndStoreVoteRecords(realmProposals);

    await prisma.realmLatestTimeStamp.upsert({
      where: {
        realmPubKey: grapePubkey.toBase58(),
      },
      update: {
        latestTimeStamp: latestTimeStamp,
      },
      create: {
        realmPubKey: grapePubkey.toBase58(),
        latestTimeStamp: latestTimeStamp,
      },
    });

    console.log(`Stored ${realmVoteRecords.length} records in the database ✅`);

    return res.status(200).json({ success: true });
  } catch (e) {
    console.log(e);

    return res.status(200).json({ success: false });
  }

  async function getAllProposals(
    governanceWithProposals: ProgramAccount<Governance>[]
  ): Promise<ProgramAccount<Proposal>[]> {
    let start = performance.now();
    const allProposalPromises: Promise<ProgramAccount<Proposal>[]>[] = [];
    for (let govern of governanceWithProposals) {
      const proposals = getProposalsByGovernance(
        connection,
        splProgramId,
        govern.pubkey
      );

      allProposalPromises.push(proposals);
    }
    const allProposals = await Promise.all(allProposalPromises);
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

    let end = performance.now();

    console.log(`Got all proposals in ${(end - start) / 1000}secs ✅`);

    return realmProposals;
  }
  async function getAndStoreVoteRecords(
    realmProposals: ProgramAccount<Proposal>[]
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
        splProgramId,
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
      getCreateInputData(record, proposalToCreateTime)
    );

    await prisma.voteRecord.createMany({
      data: realmVoteData,
    });

    let end = performance.now();

    console.log(`Got all vote records in fast ${(end - start) / 1000}secs ✅`);

    return realmVoteRecords;
  }

  async function getNewProposals(
    realmProposals: ProgramAccount<Proposal>[]
  ): Promise<ProgramAccount<Proposal>[]> {
    const prevTimestampRaw = await prisma.realmLatestTimeStamp.findUnique({
      where: {
        realmPubKey: grapePubkey.toBase58(),
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

  function getCreateInputData(
    voteRecord: ProgramAccount<VoteRecord>,
    proposalToCreateTime: Map<string, number>
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
      realmPubKey: grapePubkey.toBase58(),
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
