document.addEventListener('DOMContentLoaded', () => {
    const form = document.querySelector('form')

    form.addEventListener('submit', e => {
        e.preventDefault()
        // on check les dates une dernière fois
        if (checkDates() === true) {
            confirm('Validez-vous cette saisie ?').then(response => {
                if (response) form.submit()
            })
        } else {
            alert('Une ou plusieurs dates sont incorrectes!')
            return false
        }
    })

    const checkDates = () => {
        const listDatePicker = document.querySelectorAll('input[type="date"]')
        let result = true;

        listDatePicker.forEach(el => {
            if (el.value) {
                let dateMoment = moment(el.value, "YYYY-MM-DD", true)
                if (!dateMoment.isValid()) result = false;

                // Contrôle que la date est ≤ à aujourd'hui
                let diff = dateMoment.diff(moment(), 'days')
                if (diff > 0) result = false
            }
        })

        return result
    }
})