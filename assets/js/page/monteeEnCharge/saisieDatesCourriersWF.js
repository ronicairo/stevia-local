document.addEventListener('DOMContentLoaded', () => {
    const form = document.querySelector('form')
    const inputDates = document.querySelectorAll('input[type="date"]')
    const inputText = document.querySelectorAll('input[type="text"]')
    const vars = JSON.parse(document.getElementById('js-vars').dataset.vars)
    const numeroReference = document.getElementById('numeroReference').value

    const btnHelp = document.querySelector('.btn-help')
    if (btnHelp) {
        btnHelp.addEventListener('click', () => {
            alert(
                '<b><span class="text-warning">Majoration inconnue ou soldée dans DETTES</span> non cochée : </b><br>' +
                'Il y aura un rattachement effectif et les contrôles porteront sur :<br>' +
                '- N° majoration : 10 chiffres obligatoires<br>' +
                '- La majoration doit être présente dans SUCRE<br>' +
                '- Avoir le même débiteur que la créance de référence<br>' +
                '- Avoir une nature de compte déclarée dans le paramètre fonctionnel (app_gdr_list_majoration)<br>' +
                '<b><span class="text-warning">Majoration inconnue ou soldée dans DETTES</span> cochée : </b><br>' +
                'Pas de rattachement et avance du workflow :<br>' +
                '- Si un n° est saisi, il sera inséré en base pour information mais aucun contrôle ne sera effectué'
            )
        })
    }

    inputDates.forEach(el => {
        // Tous les champs date sauf celui de WFNOTIFICATION sont désactivés
        if (!el.id.includes('WFNOTIFICATION')) el.disabled = true

        // Au focus : désactiver et vider tous les champs date des lignes suivantes
        el.addEventListener('focus', () => {
            let nextRow = el.closest('.form-row').nextElementSibling

            while (nextRow) {
                const nextDate = nextRow.querySelector('input[type="date"]')

                if (nextDate) {
                    nextDate.disabled = true
                    nextDate.value = ""
                }

                nextRow = nextRow.nextElementSibling
            }
        })

        // Au changement ou à la perte de focus on valide la date et on débloque le prochain champ date
        const validateAndUnlock = () => {
            let valid = false
            const parent = el.closest('.form-row')
            let dateValue = moment(el.value, "YYYY-MM-DD", true)

            if (dateValue.isValid()) {
                // La date de référence (date de mandatement si renseignée sinon date de détection de la créance) est dans vars au format "DD/MM/YYYY"
                let dateDetect = moment(vars.dateDetect, "DD/MM/YYYY", true)
                let dateMandatement = moment(vars.dateMandatement, "DD/MM/YYYY", true)

                // Recherche d'une date valide dans la ligne précédente (s'il y en a une)
                let previousRow = parent.previousElementSibling
                let previousInput = null
                let datePreviousValue = null

                while (previousRow && !datePreviousValue) {
                    previousInput = previousRow.querySelector('input[type="date"]')

                    if (previousInput) {
                        let tmpDate = moment(previousInput.value, "YYYY-MM-DD", true)
                        if (tmpDate.isValid()) datePreviousValue = tmpDate
                    }

                    previousRow = previousRow.previousElementSibling
                }

                if (datePreviousValue) {
                    if (moment.duration(dateValue.diff(datePreviousValue)).as('minutes') < 0) {
                        el.value = ""
                        alert(`La date saisie ne doit pas être antérieure à la date précédente: ${moment(previousInput.value, "YYYY-MM-DD").format("DD/MM/YYYY")}`)
                    } else {
                        valid = true
                    }
                } else if (dateMandatement) {
                    if (moment.duration(dateValue.diff(dateMandatement)).as('minutes') < 0) {
                        el.value = ""
                        alert(`La date saisie ne doit pas être antérieure au ${vars.dateMandatement}`)
                    } else {
                        valid = true
                    }
                } else {
                    if (moment.duration(dateValue.diff(dateDetect)).as('minutes') < 0) {
                        el.value = ""
                        alert(`La date saisie ne doit pas être antérieure au ${vars.dateDetect}`)
                    } else {
                        valid = true
                    }
                }
            }

            // Si la date est valide, rechercher et débloquer le prochain champ date
            if (valid) {
                let nextRow = parent.nextElementSibling

                while (nextRow) {
                    const nextDate = nextRow.querySelector('input[type="date"]')

                    if (nextDate) {
                        nextDate.disabled = false
                        nextDate.min = el.value
                        break
                    }

                    nextRow = nextRow.nextElementSibling
                }
            }
        }

        el.addEventListener('focusout', validateAndUnlock)
    })

    inputText.forEach(el => {
        el.addEventListener('focus', () => {
            // Désactive et vide tous les champs text des lignes suivantes
            let nextRow = el.closest('.form-row').nextElementSibling

            while (nextRow) {
                const nextInput = nextRow.querySelector('input[type="text"]')

                if (nextInput) {
                    nextInput.disabled = true
                    nextInput.value = ""
                }

                nextRow = nextRow.nextElementSibling
            }
        })
    })

    form.addEventListener('submit', e => {
        e.preventDefault()

        if (checkNumCreance()) {
            if (checkDates()) {
                if (showMessageForEcheance()) {
                    alert('La nouvelle échéance sera générée après les traitements journaliers (J+1).')

                    document.querySelector('.close-modal-button').addEventListener('click', () => {
                        // SI L'UTILISATEUR CLIQUE SUR LE BOUTON "OK" DE L'ALERT, ON SUBMIT LE FORMULAIRE
                        confirm('Validez-vous définitivement cette saisie?\nAucun retour ne sera possible après validation.\n\nLa nouvelle échéance sera générée après les traitements journaliers (J+1).').then(response => {
                            if (response) form.submit()
                        })
                    })
                } else {
                    confirm('Validez-vous définitivement cette saisie?\nAucun retour ne sera possible après validation.').then(response => {
                        if (response) form.submit()
                    })
                }
            } else if (dateMandatement) {
                alert(`Une ou plusieurs dates sont incorrectes. Vérifiez l'ordre chronologique des dates ou qu'aucune date ne soit antérieure au ${vars.dateMandatement}`)
                return false
            } else {
                alert(`Une ou plusieurs dates sont incorrectes. Vérifiez l'ordre chronologique des dates ou qu'aucune date ne soit antérieure au ${vars.dateDetect}`)
                return false
            }
        } else {
            alert('Le numéro de majoration est incorrect.\nVeuillez vous référer à l\'icône <span class="btn-help">?</span> pour plus d\'informations.')
            return false
        }
    })

    const checkDates = () => {
        const listDatePicker = document.querySelectorAll('input[type="date"]')
        let result = true
        const dateMandatement = moment(vars.dateMandatement, "DD/MM/YYYY", true)

        listDatePicker.forEach((el, index) => {
            if (el.value) {
                let dateMoment = moment(el.value, "YYYY-MM-DD", true)
                if (!dateMoment.isValid()) result = false

                if (index > 0) {
                    const previousMoment = moment(listDatePicker[index - 1].value, "YYYY-MM-DD", true)

                    if (previousMoment.isValid() && moment.duration(dateMoment.diff(previousMoment)).as('minutes') < 0) {
                        result = false
                    }
                } else if (dateMandatement) {
                    if (moment.duration(dateMoment.diff(dateMandatement)).as('minutes') < 0) {
                        result = false
                    }
                } else {
                    const dateDetect = moment(vars.dateDetect, "DD/MM/YYYY", true)

                    if (moment.duration(dateMoment.diff(dateDetect)).as('minutes') < 0) {
                        result = false
                    }
                }
            }
        })

        return result
    }

    const showMessageForEcheance = () => {
        const listDatePicker = document.querySelectorAll('input[type="date"]')
        let mdmToInsert = false
        let response = false

        listDatePicker.forEach(el => {
            if (
                el.id.replaceAll('mec_saisie_dates_courriers_', '') === 'WFMISEDEMEURE' &&
                el.value !== ''
            ) mdmToInsert = true

            if (mdmToInsert && el.value === '') response = true
        })

        return response
    }

    const checkNumCreance = () => {
        const numCreanceInputs = document.querySelectorAll('.numcreance')
        let result = true

        numCreanceInputs.forEach(el => {
            if (el.value) {
                $.ajax({
                    url: Routing.generate('creance_regroupee_check_exist'),
                    data: {
                        creanceMonteeEnCharge: numeroReference,
                        creanceMajo: el.value
                    },
                    type: "POST",
                    async: false,
                    success: function (data) {
                        if (data === false) {
                            result = false
                        }
                    },
                    error: function () {
                        result = false
                    }
                })
            }
        })

        return result
    }
})