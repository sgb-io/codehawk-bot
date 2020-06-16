import { Application, Octokit, Context } from 'probot'
// import { addComplexityToFile  } from 'codehawk-cli'
import { Webhooks } from '@octokit/webhooks'

// TODO expose addComplexityToFile from codehawk-cli
// this would skip coverage mapping and dependency counts

// @see https://github.com/probot/linter/blob/master/index.js

interface Result {
  filename: string
  metrics: any
  message: string
}

// This works but appears to be missing from the type?
type FileWithContent = Octokit.ReposGetContentsResponse & {
  content: string
}

const generatePrComment = (results: Array<Result>): string => {

  return `
    ### Codehawk Static Analysis Results
    ${results.map((result) => {
      return `
        - ${result.filename}, ${result.metrics}
      `
    })}
  `
}

const analyzeFiles = (
  compare: Octokit.Response<Octokit.ReposCompareCommitsResponse>,
  context: Context<Webhooks.WebhookPayloadPullRequest>
) => {
  return Promise.all(compare.data.files.map(async file => {

    const content = await context.github.repos.getContents(
      context.repo({
        path: file.filename,
        ref: context.payload.pull_request.head.ref.replace('refs/heads/', '')
      })
    )

    const fileWithContents = content.data as FileWithContent
    const text = Buffer.from(fileWithContents.content, 'base64').toString()
    console.log(text)

    return {
      filename: file.filename,
      // metrics: addComplexityToFile(text)
      metrics: 'TODO metrics!'
    }
  }))
}

export = (app: Application) => {

  app.on('pull_request.edited', async (context) => {
    

    const compare = await context.github.repos.compareCommits(context.repo({
      base: context.payload.pull_request.base.sha,
      head: context.payload.pull_request.head.sha
    }))

    console.log(compare.data)
    const analyzedFiles: any = await analyzeFiles(compare, context)
    const comment = generatePrComment(analyzedFiles)
    const params = context.issue({ body: comment })

    await context.github.issues.createComment(params)
    console.log('PR edit detected, analysis was done and comment was added!')
  })

  // app.on('pull_request.opened', async (context) => {
  //   const issueComment = runCodehawkOnPr(context.payload.pull_request)
  //   await context.github.issues.createComment(issueComment)
  // })

  // app.on('pull_request.synchronize', async (context) => {
  //   const issueComment = runCodehawkOnPr(context.payload.pull_request)
  //   await context.github.issues.createComment(issueComment)
  // })

  // app.on('pull_request.reopened', async (context) => {
  //   const issueComment = runCodehawkOnPr(context.payload.pull_request)
  //   await context.github.issues.createComment(issueComment)
  // })

}
