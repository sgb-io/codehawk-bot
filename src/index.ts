import { Application, Octokit, Context } from 'probot'
import { calculateComplexity } from 'codehawk-cli'
import { Webhooks } from '@octokit/webhooks'

// Reference impl. https://github.com/probot/linter/blob/master/index.js

interface Result {
  filename: string
  metrics: any
  message: string
}

// This works but appears to be missing from the type?
type FileWithContent = Octokit.ReposGetContentsResponse & {
  content: string
}

const SUPPORTED_EXTENSIONS = ['js', 'jsx', 'ts', 'tsx']

const round = (num: number): number => Math.round(num * 100) / 100

const getScoreEmoji = (score: number): string => {
  if (score > 60) return ':warning:'
  // if (score > 50) return ':warning:'
  return ':white_check_mark:'
}

const formatComplexityScore = (score: number): string => {

  const rounded = round(score)
  const emoji = getScoreEmoji(score)

  return `${rounded} ${emoji}`
}

const generateTableLines = (filteredResults: Array<Result>): string => {
  return filteredResults.map((result) => {
    const { filename, metrics } = result
    const { lineEnd, dependencies, codehawkScore } = metrics
    // TODO need previous score
    return (
      `| ${filename} | ${lineEnd} | ${dependencies.length} | 0 | ${formatComplexityScore(codehawkScore)} |`
    )
  }).join('\n')
}

const generatePrComment = (results: Array<Result>): string => {
  const filteredResults = results.filter(r => !!r.metrics)

  return `
  ## Codehawk Static Analysis Results

  ${filteredResults.length} file${filteredResults.length > 1 ? 's' : ''} changed

  | File | Total Lines | No. Dependencies | Complexity (before) | Complexity (after) |
  | ---- | ----------- | ---------------- | ------------------- | ------------------ |
  ${generateTableLines(filteredResults)}

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
    const { filename } = file

    // extension
    const extension = filename.slice((filename.lastIndexOf(".") - 1 >>> 0) + 2)
    const isTypescript = extension === 'ts' || extension === 'tsx'

    if (SUPPORTED_EXTENSIONS.indexOf(extension) < 0) {
      return {
        filename,
        metrics: null
      }
    }

    return {
      filename: file.filename,
      metrics: calculateComplexity(text, extension, isTypescript, false) // Flow not supported
    }
  }))
}

export = (app: Application) => {

  app.on('pull_request.edited', async (context) => {
    console.log('webhook received for pull_request.edited')
    const compare = await context.github.repos.compareCommits(context.repo({
      base: context.payload.pull_request.base.sha,
      head: context.payload.pull_request.head.sha
    }))

    console.log('analyzing files...')
    const analyzedFiles: Array<any> = await analyzeFiles(compare, context)
    const filesWithMetrics = analyzedFiles.filter(f => !!f.metrics)

    if (filesWithMetrics.length === 0) {
      // Do nothing - no metrics were generated for this change
      console.warn('no changes.')
      return
    }

    const comment = generatePrComment(filesWithMetrics)
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
