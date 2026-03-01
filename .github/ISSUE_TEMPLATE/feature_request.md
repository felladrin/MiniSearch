---
name: Feature request
description: Suggest an idea for this project
title: "[FEATURE] "
labels: ["enhancement"]
assignees: []
body:
  - type: markdown
    attributes:
      value: |
        Thanks for suggesting a new feature! Please provide as much detail as possible to help us understand your vision.

  - type: textarea
    id: problem-description
    attributes:
      label: Is your feature request related to a problem?
      description: A clear and concise description of what the problem is
      placeholder: I'm always frustrated when [...]
    validations:
      required: true

  - type: textarea
    id: solution-description
    attributes:
      label: Describe the solution you'd like
      description: A clear and concise description of what you want to happen
    validations:
      required: true

  - type: textarea
    id: alternatives
    attributes:
      label: Describe alternatives you've considered
      description: A clear and concise description of any alternative solutions or features you've considered

  - type: textarea
    id: additional-context
    attributes:
      label: Additional context
      description: Add any other context or screenshots about the feature request here

  - type: dropdown
    id: alignment
    attributes:
      label: Alignment with MiniSearch's goals
      description: How does this feature align with MiniSearch's minimalist, privacy-focused philosophy?
      options:
        - "Strongly aligns - enhances privacy/minimalism"
        - "Moderately aligns - useful but adds complexity"
        - "Needs consideration - potential trade-offs"
        - "Not sure - need discussion"
    validations:
      required: true

  - type: textarea
    id: implementation-ideas
    attributes:
      label: Implementation ideas (optional)
      description: Do you have any ideas about how this could be implemented?
      placeholder: Technical thoughts, potential approaches, etc.

  - type: dropdown
    id: priority
    attributes:
      label: Priority (your assessment)
      description: How important is this feature to you?
      options:
        - "High - would significantly improve my experience"
        - "Medium - nice to have"
        - "Low - minor improvement"
    validations:
      required: true
---
