window.addEventListener('DOMContentLoaded', () => {
    const impressionCourrier = (id, type_courrier, nom_courrier, apiDocServer) => {
        let url = Routing.generate('creer_courrier_libre', {
            courrierName: nom_courrier,
            courrierType: type_courrier,
            creanceNumber: id
        }, true)
        $.ajax({
            type: "POST",
            url: url,
            async: false,
            success: data => {
                if (analyseResultatPapyrus(data['value'], false)) {
                    openEditor(data['environment'], data['reference'], data['filename'], apiDocServer)
                }
            },
            error: data => {
                let resultat = data.responseText
                let touteLigne = resultat.split("\n")
                let premiereLigne = touteLigne[0]
                alert(`Erreur : ${premiereLigne}, veuillez consulter le suivi des traitements automatiques.`)
            }
        })
    }

    const id = document.getElementById('numero_creance'),
        type_courrier = document.getElementById('type_courrier'),
        nom_courrier = document.getElementById('nom_courrier'),
        apiDocServer = document.getElementById('api_doc_server')

    if (id && type_courrier && nom_courrier && apiDocServer) {
        impressionCourrier(id.value, type_courrier.value, nom_courrier.value, apiDocServer.value)
    } else {
        alert('Aucun numéro de créance trouvé')
    }

    const createList = () => {
        let attachment = []
        const numeroCreance = document.getElementById('numero_creance').value
        const fileListContainer = document.getElementById('fileListContainer')

        $.ajax({
            type: "POST",
            url: Routing.generate('file_list'),
            data: {
                criteria: numeroCreance
            },
            async: true,
            success: data => {
                let fileList = JSON.parse(data)

                if (data.length > 2) {
                    const select = document.createElement('select')
                    select.id = 'list_file'
                    select.name = 'my-select[]'
                    select.multiple = true

                    for (const file in fileList) {
                        const option = document.createElement('option')
                        option.value = fileList[file]
                        option.text = file
                        select.appendChild(option)
                    }

                    fileListContainer.innerHTML = select.outerHTML

                    const fusionButton = document.createElement('button')
                    fusionButton.id = 'btn_valider'
                    fusionButton.classList.add('btn', 'btn-success')
                    fusionButton.textContent = 'Fusionner les documents'

                    document.getElementById('courrierButtons').appendChild(fusionButton)

                    fusionButton.addEventListener('click', () => {
                        const fusionLoading = document.getElementById('fusionLoading')
                        fusionLoading.classList.add('d-block')
                        fusionLoading.classList.remove('d-none')

                        $.ajax({
                            type: "POST",
                            url: Routing.generate('file_merge'),
                            data: {
                                attachment: attachment,
                                rtfFile: document.getElementById('nom_fichier').value
                            },
                            async: true,
                            success: data => {
                                fusionLoading.classList.add('d-none')
                                fusionLoading.classList.remove('d-block')

                                let environment = data[1]
                                data = JSON.parse(data[0])

                                if (typeof data['erreurs'] !== "undefined" && data['erreurs'].length > 0) {
                                    let msg = 'Le courrier n\'a pas été généré à cause des erreurs suivantes:\n\n'
                                    data['erreurs'].forEach(function (entry) {
                                        msg = msg + '   -> ' + entry.replace('&lt;', '\74').replace('&gt;', '\76') + '\n'
                                    })

                                    alert(msg)
                                } else {

                                    if (data['fichier_utilisateur_genere']) {
                                        // A la génération du courrier un formulaire #openEditor est créé, lorsque l'on fait une fusion il fallait en recréer un nouveau
                                        // Pour ça j'ai réutilisé la fonction openEditor pour éviter le duplicat. Je devais donc supprimé le premier form créé
                                        document.getElementById('openEditor').remove()
                                        let filename = data['fichier_utilisateur_genere'].split('/').slice(-1)
                                        openEditor(environment, $('#numero_creance').val(), filename, $("#api_doc_server").val(), false)
                                    } else {
                                        alert('Une erreur est survenue lors de la conversion du fichier : ' + data["erreurs"].map(function (x) {
                                            return x + " "
                                        }))
                                    }
                                }
                            },
                            error: (response, textStatus, errorThrown) => {
                                fusionLoading.classList.add('d-none')
                                fusionLoading.classList.remove('d-block')

                                if (response.status === 400 && response.responseJSON.message != null) alert('Une erreur est survenue : ' + response.responseJSON.message)
                                else alert('Une erreur est survenue : ' + errorThrown)
                            }
                        })
                    })

                    $('#list_file').multiSelect({
                        selectableHeader: '<div class="text-white bg-primary text-center py-2 fs-4">PJ de la pochette</div>',
                        selectionHeader: '<div class="text-white bg-primary text-center py-2 fs-4">PJ sélectionnée(s)</div>',
                        keepOrder: true,
                        afterSelect: values => attachment.push(values),
                        afterDeselect: values => {
                            for (let count = 0; count < attachment.length; count++) {
                                if (attachment[count][0] === values[0]) attachment.splice(count, 1)
                            }
                        }
                    })

                    fileListContainer.classList.remove('text-center', 'fs-5')
                } else {
                    fileListContainer.textContent = "Aucun fichier n'est placé dans la pochette"
                }
            },
            error: (XMLHttpRequest, textStatus, errorThrown) => {
                alert('Une erreur est survenue : ' + errorThrown)
            }
        })
    }

    if (document.getElementById('numero_creance')) createList()
})