import deploymentsJSON from '../deployments.json'

type Deployments = {
  implementation: string
  proxyAdmin: string
  proxy: string
}
export const deployments = deploymentsJSON as unknown as {
  [chainId: string]: {
    wallets: {
      deployer: string
      admin: string
      backend: string
      disputeResolver: string
      treasury: string
    }
    PointsSBT: Deployments
    VisibilityCredits: Deployments
    VisibilityServices: Deployments
  }
}
