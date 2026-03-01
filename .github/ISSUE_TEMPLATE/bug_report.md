---
name: Bug report
description: Create a report to help us improve
title: "[BUG] "
labels: ["bug"]
assignees: []
body:
  - type: markdown
    attributes:
      value: |
        Thanks for taking the time to fill out this bug report! Please provide as much detail as possible.

  - type: textarea
    id: bug-description
    attributes:
      label: Describe the bug
      description: A clear and concise description of what the bug is
      placeholder: What happened? What did you expect to happen?
    validations:
      required: true

  - type: textarea
    id: steps-to-reproduce
    attributes:
      label: Steps to reproduce
      description: Please provide detailed steps to reproduce the issue
      placeholder: |
        1. Go to '...'
        2. Click on '....'
        3. Scroll down to '....'
        4. See error
    validations:
      required: true

  - type: textarea
    id: expected-behavior
    attributes:
      label: Expected behavior
      description: A clear and concise description of what you expected to happen
    validations:
      required: true

  - type: textarea
    id: screenshots
    attributes:
      label: Screenshots
      description: If applicable, add screenshots to help explain your problem
      placeholder: Drag and drop images here or paste them

  - type: dropdown
    id: os
    attributes:
      label: Operating System
      description: What operating system are you using?
      options:
        - Windows 11
        - Windows 10
        - macOS 15.x
        - macOS 14.x
        - macOS 13.x
        - Ubuntu 22.04
        - Ubuntu 20.04
        - Other Linux
        - Other
    validations:
      required: true

  - type: dropdown
    id: browser
    attributes:
      label: Browser
      description: What browser are you using?
      options:
        - Chrome
        - Firefox
        - Safari
        - Edge
        - Other
    validations:
      required: true

  - type: input
    id: version
    attributes:
      label: MiniSearch version
      description: What version of MiniSearch are you using?
      placeholder: latest, v1.0.0, etc.
    validations:
      required: true

  - type: input
    id: docker-version
    attributes:
      label: Docker version (if applicable)
      description: What Docker version are you using?
      placeholder: e.g., 24.0.7

  - type: textarea
    id: additional-context
    attributes:
      label: Additional context
      description: Add any other context about the problem here

  - type: dropdown
    id: deployment-type
    attributes:
      label: Deployment type
      description: How are you running MiniSearch?
      options:
        - Docker image
        - Building from source
        - Development server
        - Other
    validations:
      required: true

  - type: textarea
    id: custom-config
    attributes:
      label: Custom configuration (if applicable)
      description: Any custom configuration you're using
      placeholder: Environment variables, custom settings, etc.
---
