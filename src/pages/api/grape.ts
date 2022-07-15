// src/pages/api/grape.ts
import type { NextApiRequest, NextApiResponse } from "next";
import fs from "fs";
import { prisma } from "../../server/db/client";
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
} from "@solana/spl-governance";

import { PublicKey, Connection } from "@solana/web3.js";
import { Prisma, Vote, VoteRecordVersion } from "@prisma/client";

enum VoteVersion {
  V1 = 7,
  V2 = 12,
}
const grape = async (req: NextApiRequest, res: NextApiResponse) => {
  const splProgramId = new PublicKey(
    "GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw"
  );

  const grapePubkey = new PublicKey(
    "By2sVGZXwfQq6rAiAM3rNPJ9iQfb5e2QhnF4YjJ4Bip"
  );

  const testGovern = new PublicKey(
    "BUfya7kEAgoCGtN3SYXiPciVjoe4dCo8EfnEuvaMTfHs"
  );
  try {
    const connection = new Connection("https://rpc.ankr.com/solana", "recent");

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
    let realmProposals: ProgramAccount<Proposal>[] = [];

    for (let govern of governanceWithProposals) {
      const proposals = await getProposalsByGovernance(
        connection,
        splProgramId,
        govern.pubkey
      );

      realmProposals = realmProposals.concat(proposals);
    }

    console.log("Get all proposals for each governance ✅");

    // Get all the vote records for each proposal----------------------------------
    let realmVoteRecords: ProgramAccount<VoteRecord>[] = [];

    // TODO: filter out the proposals that have no votes

    const proposalToCreateTime = new Map<string, number>();
    for (let proposal of realmProposals) {
      proposalToCreateTime.set(
        proposal.pubkey.toBase58(),
        proposal.account.draftAt.toNumber()
      );
      const voteRecords = await getGovernanceAccounts(
        connection,
        splProgramId,
        VoteRecord,
        [pubkeyFilter(1, proposal.pubkey)!]
      );

      realmVoteRecords = realmVoteRecords.concat(voteRecords);
    }

    console.log("Got all vote records for each proposal ✅");

    // Store the data in the database
    let realmVoteData: Prisma.VoteRecordCreateInput[];
    realmVoteData = realmVoteRecords.map((record) =>
      getCreateInputData(record, proposalToCreateTime)
    );

    // fs.writeFile(
    //   "./realmVoteData.json",
    //   JSON.stringify(realmVoteData),
    //   "utf-8",
    //   (err) => console.log
    // );

    // let realmVoteDataRaw = fs.readFileSync("./realmVoteData.json", "utf8");
    // let realmVoteData: Prisma.VoteRecordCreateInput[] =
    //   JSON.parse(realmVoteDataRaw);

    const voteRecords = await prisma.voteRecord.createMany({
      data: realmVoteData,
    });

    return res.status(200).json({ success: true });
  } catch (e) {
    console.log(e);

    return res.status(200).json({ success: false });
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

export default grape;
