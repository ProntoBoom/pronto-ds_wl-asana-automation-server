// Keywords are stored/typed freely (e.g. via the seed script or a future admin
// UI) and get interpolated straight into a RegExp — escape them so a keyword
// containing regex-special characters (e.g. "?", "(") can't throw or silently
// change what it matches.
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const containsUrgentKeyword = (urgentKeywords, notes) => {
  const excludedPatterns = [
    /\bnot urgent\b/i,
    /Priority:/i,
    /\bbroken link\b/i,
    /\bbroken links\b/i,
    /\bbug\/problem\b/i
  ]

  const hasExcludedPattern = excludedPatterns.some((pattern) => pattern.test(notes))

  if (hasExcludedPattern) {
    console.log('Excluded pattern found')

    // Create a clean version of the text by removig the excluded patterns
    let cleanNotes = notes
    excludedPatterns.forEach((pattern) => {
      cleanNotes = cleanNotes.replace(pattern, '')
    })

    // Check if any urgent keywords remain in the cleaned text
    const hasUrgentKeyword = urgentKeywords.some((keyword) => {
      const regex = new RegExp(`\\b${escapeRegex(keyword)}\\b`, 'i')
      const isUrgent = regex.test(cleanNotes)

      if (isUrgent) console.log(`Urgent keyword found after exclusion filtering: ${keyword}`)
      return isUrgent
    })
    return hasUrgentKeyword
  }

  // If no excluded patterns, check for urgent keywords in original text
  return urgentKeywords.some(keyword => {
    const regex = new RegExp(`\\b${keyword}\\b`, 'i')
    if (regex.test(notes)) {
      console.log(`Urgent keyword found: ${keyword}`)
      return true
    }
    return false
  })
}
