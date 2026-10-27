function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set; see test/contract/README.md`);
  return value;
}

export const contractEnv = {
  url: (process.env.YT_CONTRACT_URL ?? 'http://localhost:8080').replace(/\/+$/, ''),
  /** The URL YouTrack uses to call itself; inside the container that's always port 8080. */
  selfUrl: process.env.YT_CONTRACT_SELF_URL ?? 'http://localhost:8080',
  adminToken: required('YT_CONTRACT_ADMIN_TOKEN'),
  techToken: required('YT_CONTRACT_TECH_TOKEN'),
  userToken: required('YT_CONTRACT_USER_TOKEN'),
  /** A user who can't see the test project. */
  outsiderToken: required('YT_CONTRACT_OUTSIDER_TOKEN'),
  /** A user who can see the test project but lacks Update Issue. */
  readerToken: required('YT_CONTRACT_READER_TOKEN'),
  project: process.env.YT_CONTRACT_PROJECT ?? 'HFT',
  issue: process.env.YT_CONTRACT_ISSUE ?? 'HFT-1',
  group: process.env.YT_CONTRACT_GROUP ?? 'hidden-fields-readers',
  /** YouTrack's group of every signed-in user; the Allowed group unless a test picks another. */
  everyone: 'Registered Users',
  exposed: ['HF External ID', 'HF Sync State'],
  unexposed: 'HF Internal Note',
};
