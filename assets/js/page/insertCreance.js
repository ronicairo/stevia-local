// Bloquer la soummission de formulaire
const preventSubmit = () => {
    const inputs = document.querySelectorAll("input")
    const btnValid = document.getElementById('btnValider')

    btnValid.disabled = true
    inputs.forEach((input) => {
        input.disabled = true
    })
}

// Vérifier que tous les inputs sont remplis
const checkInput = () => {
    const inputs = document.querySelectorAll('input:not([type="hidden"])')
    let isValid = true

    // Vérification de la validité des champs
    inputs.forEach((input) => {
        if ((input.type === 'checkbox' && !input.checked) ||
            (input.type !== 'checkbox' && input.value.trim() === '')) {
            isValid = false
        }
    })

    return isValid
}

// formulaire insertion par nature de compte
const submitFormNatureCompte = () => {
    const btnValid = document.querySelector('#insert-by-nature-compte #btnValider')
    if (!btnValid) return // Vérifier si le bouton existe avant d'attacher l'événement

    // Événement sur le bouton valider
    btnValid.addEventListener('click', (e) => {
        e.preventDefault()

        if (!checkInput()) return // Si les champs ne sont pas valides, on arrête ici

        // Affichage d'une alerte pour informer l'utilisateur
        const messageClose = "<br>Cliquer sur <b>Fermer</b> pour continuer"
        const spinner = document.querySelector('.spinner')
        const nature = document.getElementById('nature_de_compte')

        alert(`L'insertion des nouvelles créances pour la nature ${nature.value} a commencé, ce traitement peut prendre plusieurs minutes.\nMerci de patienter.`)

        // Désactivation du bouton et affichage du spinner
        spinner.classList.remove('d-none')
        btnValid.classList.add('d-none')

        // Envoi de la requête AJAX
        $.ajax({
            url: Routing.generate('insert_creance_auto'),
            data: {nature: nature.value},
            dataType: 'json',
            async: true,
            success: function (response) {
                //  Fermer la modal et afficher un message de succès
                if(document.querySelector('.modal'))
                    document.querySelector('.modal').classList.remove('d-block')

                alert(response.message + messageClose)
            },
            error: (response) => {
                // Gestion des erreurs
                if (response.statusText.toLowerCase() === 'gateway timeout') {
                    location.reload()
                } else {
                    alert(`Integration impossible! Aucune créance n'a été intégrée en base de données.${messageClose}`)
                }
            },
            complete: () => {
                // Rafraîchir la page après la fermeture de la modal
                document.querySelectorAll('.modal button').forEach((btn) => {
                    btn.addEventListener('click', () => location.reload())
                })
            }
        })
    })
}
// Formulaire insersion reprise
const submitFormReprise = () => {
    const btnValid = document.querySelector('#insert-by-num-creance #btnValider')

    if(!btnValid) return;

    btnValid.addEventListener('click', () => {
        const spinner = document.querySelector('.spinner')

        if (!checkInput()) return

        // Ajout du spinner et du texte au bouton
        spinner.classList.remove('d-none')
        btnValid.classList.add('d-none')

        // Désactiver le bouton et l'input file après un très court délai
        setTimeout(() => {
            preventSubmit()
        }, 10)
    })
}


document.addEventListener('DOMContentLoaded', function () {
    const verrou = document.getElementById('verrou')
    if (verrou?.value) preventSubmit()

    submitFormNatureCompte()
    submitFormReprise()
})