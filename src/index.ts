import { Application, Octokit, Context } from 'probot'
import { calculateComplexity } from 'codehawk-cli'
import { Webhooks } from '@octokit/webhooks'
import { CodehawkComplexityResult } from 'codehawk-cli/build/types'

interface Result {
  filename: string
  metrics: CodehawkComplexityResult | null
  previousMetrics: CodehawkComplexityResult | null
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

  return ':white_check_mark:'
}

const getChangeEmoji = (diff: number): string => {
  if (diff < 0) return ':chart_with_downwards_trend: :thumbsup:'
  if (diff > 0) return ':chart_with_upwards_trend: :thumbsdown:'
  return ''
}

const formatComplexityScore = (score: number): string => {
  const rounded = round(score)
  const emoji = getScoreEmoji(score)

  return `${rounded} ${emoji}`
}

const generateTableLines = (filteredResults: Array<Result>): string => {
  return filteredResults.map((result) => {
    const { filename, metrics, previousMetrics } = result

    if (!metrics) {
      return ''
    }

    const { lineEnd } = metrics
    // Note - we invert the codehawkScore numbers here.
    // This is because the original scale is confusing.
    const invertedCodehawkScore = 100 - metrics.codehawkScore
    const invertedPreviousCodehawkScore = (previousMetrics ? (100 - previousMetrics.codehawkScore) : undefined)

    const previous = invertedPreviousCodehawkScore ? formatComplexityScore(invertedPreviousCodehawkScore) : 'N/A'
    const updated = formatComplexityScore(invertedCodehawkScore)
    const change = invertedCodehawkScore - (invertedPreviousCodehawkScore || 0)
    const sign = change > 0 ? '+' : ''
    const diff = `${sign}${change.toFixed(2)}% ${getChangeEmoji(change)}`

    return (
      `| ${filename} | ${lineEnd} | ${previous} | ${updated} | ${diff} |`
    )
  }).join('\n')
}

const generatePrComment = (results: Array<Result>): string => {
  const filteredResults = results.filter(r => !!r.metrics)

  return `
  ## Codehawk Static Analysis Results

  ${filteredResults.length} file${filteredResults.length > 1 ? 's' : ''} changed

  | File | Total Lines | Complexity (before) | Complexity (after) | Change |
  | ---- | ----------- | ------------------- | ------------------ | ------ |
  ${generateTableLines(filteredResults)}

  `
}

const analyzeFiles = (
  compare: Octokit.Response<Octokit.ReposCompareCommitsResponse>,
  context: Context<Webhooks.WebhookPayloadPullRequest>
) => {
  return Promise.all(compare.data.files.map(async file => {
    let metrics = null
    let previousMetrics = null

    // TODO how do file renames get handled?
    // We are assuming the filename and extension is the same in base and head

    const { filename } = file
    const extension = filename.slice((filename.lastIndexOf(".") - 1 >>> 0) + 2)
    const isTypescript = extension === 'ts' || extension === 'tsx'

    // New content
    const content = await context.github.repos.getContents(
      context.repo({
        path: file.filename,
        ref: context.payload.pull_request.head.ref.replace('refs/heads/', '')
      })
    )
    const fileWithContents = content.data as FileWithContent
    const text = Buffer.from(fileWithContents.content, 'base64').toString()

    // Previous content
    const previousContent = await context.github.repos.getContents(
      context.repo({
        path: file.filename,
        ref: context.payload.pull_request.base.ref.replace('refs/heads/', '')
      })
    )
    const previousFileWithContents = previousContent.data as FileWithContent
    const previousText = Buffer.from(previousFileWithContents.content, 'base64').toString()

    if (SUPPORTED_EXTENSIONS.indexOf(extension) >= 0) {
      // Flow not supported atm
      metrics = calculateComplexity(text, extension, isTypescript, false)
      previousMetrics = calculateComplexity(previousText, extension, isTypescript, false)
    }

    return {
      filename: file.filename,
      previousMetrics,
      metrics
    }
  }))
}

export = (app: Application) => {

  const runCodehawkOnPr = async (context: Context<Webhooks.WebhookPayloadPullRequest>) => {
    const compare = await context.github.repos.compareCommits(context.repo({
      base: context.payload.pull_request.base.sha,
      head: context.payload.pull_request.head.sha
    }))

    const analyzedFiles: Array<any> = await analyzeFiles(compare, context)
    const filesWithMetrics = analyzedFiles.filter(f => !!f.metrics)

    if (filesWithMetrics.length === 0) {
      // Do nothing - no metrics were generated for this change
      return
    }

    const comment = generatePrComment(filesWithMetrics)
    const params = context.issue({ body: comment })

    await context.github.issues.createComment(params)
  }

  // This is handy for debugging the App
  // app.on('pull_request.edited', async (context) => {
  //   await runCodehawkOnPr(context)
  // })

  app.on('pull_request.opened', async (context) => {
    await runCodehawkOnPr(context)
  })

  app.on('pull_request.synchronize', async (context) => {
    await runCodehawkOnPr(context)
  })

  app.on('pull_request.reopened', async (context) => {
    await runCodehawkOnPr(context)
  })

}
