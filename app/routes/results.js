const qs = require('qs')

const teacherTrainingService = require('../services/teacher-training')
const utils = require('../utils')()

const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY

module.exports = router => {
  router.post('/results', async (req, res) => {
    await utils.processQuery(req.session.data.q, req.session.data)
    res.redirect(req.session.data.londonBorough ? '/results/filters/london' : '/results')
  })

  router.get('/results', async (req, res) => {
    const { area, defaults, provider, subjectOptions } = req.session.data

    // Pagination
    const page = Number(req.query.page) || 1
    const perPage = 20

    // Search radius
    const radius = req.session.data.radius

    // Search query
    const q = req.session.data.q || req.query.q

    // Location
    const latitude = req.session.data.latitude || req.query.latitude || defaults.latitude
    const longitude = req.session.data.longitude || req.query.longitude || defaults.longitude

    // London boroughs
    const londonBorough = utils.toArray(req.session.data.londonBorough || req.query.londonBorough || defaults.londonBorough)
    const londonBoroughItems = utils.londonBoroughItems(londonBorough).filter(item => item.checked === true)

    // Qualification
    const qualification = utils.toArray(req.session.data.qualification || req.query.qualification || defaults.qualification)
    const qualificationItems = utils.qualificationItems(qualification).map(item => {
      item.hint = false
      item.label.classes = false
      return item
    })

    // Salary
    const salary = (req.session.data.salary && req.session.data.salary[0] === 'include') || (req.query.salary && req.query.salary[0] === 'include') || (defaults.salary[0] === 'include')
    const salaryItems = utils.salaryItems(salary)

    // Send
    const send = (req.session.data.send && req.session.data.send[0] === 'include') || (req.query.send && req.query.send[0] === 'include') || (defaults.send[0] === 'include')
    const sendItems = utils.sendItems(send)

    // Subject
    const subjects = utils.toArray(req.session.data.subjects || req.query.subjects || defaults.subjects)
    const subjectItems = utils.subjectItems(subjects, {
      showHintText: false,
      checkAll: (provider || !radius) && subjects.length === 0
    })

    // Show selected subjects in filter sidebar
    // Maps array of subject codes to subject data
    const selectedSubjects = subjects.map(option => subjectOptions.find(subject => subject.value === option))

    // Study type
    const studyType = utils.toArray(req.session.data.studyType || req.query.studyType || defaults.studyType)
    const studyTypeItems = utils.studyTypeItems(studyType, {
      showHintText: false
    })

    // Vacancies
    const vacancy = (req.session.data.vacancy && req.session.data.vacancy[0] === 'include') || (req.query.vacancy && req.query.vacancy[0] === 'include') || (defaults.vacancy[0] === 'include')
    const vacancyItems = utils.vacancyItems(vacancy)

    // API query params
    const filter = {
      findable: true,
      funding_type: salary ? 'salary' : 'salary,apprenticeship,fee',
      has_vacancies: vacancy,
      qualification: qualification.toString(),
      send_courses: send,
      study_type: studyType.toString(),
      subjects: subjects.toString()
    }

    try {
      let CourseListResponse
      if (provider) {
        CourseListResponse = await teacherTrainingService.getProviderCourses(page, perPage, filter, provider.code)
      } else {
        if (radius) {
          filter.latitude = latitude
          filter.longitude = longitude
          filter.radius = radius
        }
        CourseListResponse = await teacherTrainingService.getCourses(page, perPage, filter)
      }
      const { data, links, meta, included } = CourseListResponse

      let courses = data
      if (courses.length > 0) {
        const providers = included.filter(include => include.type === 'providers')

        courses = courses.map(async courseResource => {
          const course = utils.decorateCourse(courseResource.attributes)
          const courseRalationships = courseResource.relationships

          // Get course provider
          const providerId = courseRalationships.provider.data.id
          const providerResource = providers.find(providerResource => providerResource.id === providerId)
          const provider = providerResource.attributes

          // Get course accredited body
          if (courseRalationships.accredited_body.data) {
            const accreditedBodyId = courseRalationships.accredited_body.data.id
            const accreditedBody = providers.find(providerResource => providerResource.id === accreditedBodyId)
            course.accredited_body = accreditedBody.attributes.name
          }

          // Get travel areas that school placements lie within
          // Fake it by adding current london borough/travel area being to list of placements
          let fakedPlacementArea
          if (area) {
            const selectedLondonBoroughs = londonBoroughItems.map(item => item.text)
            fakedPlacementArea = selectedLondonBoroughs[0] || area.name
          }
          const placementAreas = await utils.getPlacementAreas(provider.code, course.code, fakedPlacementArea)

          return {
            course,
            provider,
            placementAreas
          }
        })
      }

      // Results
      const results = await Promise.all(courses)

      // Pagination
      const pageCount = links.last.match(/page=(\d*)/)[1]
      // Provider courses response doesn’t return number of results
      // https://github.com/DFE-Digital/teacher-training-api/issues/1733
      const resultsCount = meta ? meta.count : results.length
      const prevPage = links.prev ? (page - 1) : false
      const nextPage = links.next ? (page + 1) : false

      const searchQuery = page => {
        const query = {
          latitude,
          longitude,
          page,
          salary,
          send,
          studyType,
          subjects,
          vacancy
        }

        return qs.stringify(query)
      }

      const pagination = {
        pages: pageCount,
        next: nextPage
          ? {
              href: `?${searchQuery(nextPage)}`,
              page: nextPage,
              text: 'Next page'
            }
          : false,
        previous: prevPage
          ? {
              href: `?${searchQuery(prevPage)}`,
              page: prevPage,
              text: 'Previous page'
            }
          : false
      }

      res.render('results', {
        area,
        googleMapsApiKey,
        latLong: [latitude, longitude],
        londonBorough,
        londonBoroughItems,
        pagination,
        provider,
        q,
        qualification,
        qualificationItems,
        radius,
        results,
        resultsCount,
        salary,
        salaryItems,
        send,
        sendItems,
        selectedSubjects,
        studyType,
        studyTypeItems,
        subjectItems,
        vacancy,
        vacancyItems
      })
    } catch (error) {
      console.log(error.stack)
      res.render('error', {
        title: error.name,
        content: error
      })
    }
  })
}
